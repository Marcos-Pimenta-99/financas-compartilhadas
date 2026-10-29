from __future__ import annotations

import calendar
import hashlib
import hmac
import os
import re
import secrets
import shutil
import sqlite3
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from fastapi import Cookie, FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "dados"
DB_PATH = DATA_DIR / "financas.db"
DATA_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Finanças Compartilhadas API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_origin_regex=r"http://(192\.168|10|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}:5173",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def connection() -> sqlite3.Connection:
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA foreign_keys=ON")
    return db


def password_hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000)
    return f"{salt.hex()}:{digest.hex()}"


def password_valid(password: str, stored: str) -> bool:
    salt_hex, expected = stored.split(":", 1)
    actual = password_hash(password, bytes.fromhex(salt_hex)).split(":", 1)[1]
    return hmac.compare_digest(actual, expected)


def add_column(db: sqlite3.Connection, table: str, definition: str) -> None:
    name = definition.split()[0]
    columns = {row["name"] for row in db.execute(f"PRAGMA table_info({table})")}
    if name not in columns:
        db.execute(f"ALTER TABLE {table} ADD COLUMN {definition}")


def initialize() -> None:
    with connection() as db:
        accounts_existed = db.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='accounts'"
        ).fetchone() is not None
        cards_existed = db.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='cards'"
        ).fetchone() is not None
        db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            date TEXT NOT NULL,
            description TEXT NOT NULL,
            category TEXT NOT NULL,
            account TEXT NOT NULL,
            value REAL NOT NULL,
            shared INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            owner_id INTEGER NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS group_members (
            group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role TEXT NOT NULL DEFAULT 'member',
            PRIMARY KEY (group_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS group_categories (
            group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
            category TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (group_id, category)
        );
        CREATE TABLE IF NOT EXISTS group_invitations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
            invited_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            invited_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS recurring_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
            description TEXT NOT NULL,
            category TEXT NOT NULL,
            account TEXT NOT NULL,
            value REAL NOT NULL,
            day_of_month INTEGER NOT NULL,
            start_date TEXT NOT NULL,
            end_date TEXT,
            status TEXT NOT NULL DEFAULT 'Pendente',
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS transaction_splits (
            transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            amount REAL NOT NULL,
            PRIMARY KEY (transaction_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            bank TEXT NOT NULL,
            account_type TEXT NOT NULL,
            balance REAL NOT NULL DEFAULT 0,
            color TEXT NOT NULL DEFAULT '#1468ff',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS cards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            bank TEXT NOT NULL,
            ending TEXT NOT NULL,
            close_day INTEGER NOT NULL,
            due_day INTEGER NOT NULL,
            credit_limit REAL NOT NULL DEFAULT 0,
            current_invoice REAL NOT NULL DEFAULT 0,
            color TEXT NOT NULL DEFAULT 'blue',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS families (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            owner_id INTEGER NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS family_members (
            family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role TEXT NOT NULL DEFAULT 'member',
            PRIMARY KEY (family_id,user_id)
        );
        CREATE TABLE IF NOT EXISTS family_invitations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
            invited_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            invited_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS account_family_shares (
            account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
            PRIMARY KEY (account_id,family_id)
        );
        CREATE TABLE IF NOT EXISTS card_family_shares (
            card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
            family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
            PRIMARY KEY (card_id,family_id)
        );
        CREATE TABLE IF NOT EXISTS transaction_family_shares (
            transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
            family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
            PRIMARY KEY (transaction_id,family_id)
        );
        CREATE TABLE IF NOT EXISTS recurring_family_shares (
            rule_id INTEGER NOT NULL REFERENCES recurring_rules(id) ON DELETE CASCADE,
            family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
            PRIMARY KEY (rule_id,family_id)
        );
        CREATE TABLE IF NOT EXISTS recurring_exclusions (
            rule_id INTEGER NOT NULL REFERENCES recurring_rules(id) ON DELETE CASCADE,
            occurrence_key TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (rule_id, occurrence_key)
        );
        """)
        add_column(db, "transactions", "group_id INTEGER REFERENCES groups(id)")
        add_column(db, "transactions", "recurring_rule_id INTEGER REFERENCES recurring_rules(id)")
        add_column(db, "transactions", "recurring_key TEXT")
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_recurring_key ON transactions(recurring_key) WHERE recurring_key IS NOT NULL")

        first_group = db.execute("SELECT id FROM groups ORDER BY id LIMIT 1").fetchone()
        if first_group:
            db.execute("UPDATE transactions SET group_id=? WHERE shared=1 AND group_id IS NULL", (first_group["id"],))
        marcos = db.execute("SELECT id FROM users WHERE username='marcos'").fetchone()
        marina = db.execute("SELECT id FROM users WHERE username='marina'").fetchone()
        if not accounts_existed and marcos and marina:
            marcos_id, marina_id = marcos["id"], marina["id"]
            db.executemany(
                "INSERT INTO accounts(user_id,bank,account_type,balance,color) VALUES(?,?,?,?,?)",
                [
                    (marina_id, "Nubank", "Conta corrente", 2680.40, "#8b5cf6"),
                    (marina_id, "Mercado Pago", "Carteira digital", 1140.55, "#00b1ea"),
                    (marcos_id, "Itaú", "Conta corrente", 3320.20, "#f97316"),
                    (marcos_id, "Sicoob", "Conta corrente", 1278.85, "#22a06b"),
                ],
            )
        if not cards_existed and marcos and marina:
            marcos_id, marina_id = marcos["id"], marina["id"]
            db.executemany(
                """INSERT INTO cards(user_id,bank,ending,close_day,due_day,credit_limit,current_invoice,color)
                   VALUES(?,?,?,?,?,?,?,?)""",
                [
                    (marina_id, "Nubank", "4321", 2, 9, 6000, 1734.45, "violet"),
                    (marina_id, "Mercado Pago", "1048", 14, 21, 3500, 842.90, "cyan"),
                    (marcos_id, "Itaú", "6140", 10, 17, 8000, 2087.25, "orange"),
                    (marcos_id, "Sicoob", "9876", 20, 28, 5000, 975.40, "green"),
                ],
            )


def seed_categories(db: sqlite3.Connection, group_id: int) -> None:
    db.executemany(
        "INSERT OR IGNORE INTO group_categories(group_id,category,enabled) VALUES(?,?,?)",
        [(group_id, category, int(enabled)) for category, enabled in [
            ("Moradia", True), ("Alimentação", True), ("Transporte", True),
            ("Saúde", True), ("Lazer", False), ("Compras pessoais", False),
            ("Receita", True),
        ]],
    )


def backup_database() -> None:
    backup_dir = BASE_DIR / "backups"
    backup_dir.mkdir(exist_ok=True)
    destination = backup_dir / f"financas-{date.today().isoformat()}.db"
    if DB_PATH.exists() and not destination.exists():
        shutil.copy2(DB_PATH, destination)
    for old_backup in sorted(backup_dir.glob("financas-*.db"), reverse=True)[30:]:
        old_backup.unlink()


initialize()
backup_database()


def clean_text(value: str, label: str, minimum: int = 1, maximum: int = 120) -> str:
    result = " ".join(value.strip().split())
    if len(result) < minimum:
        raise HTTPException(400, f"Informe {label}")
    if len(result) > maximum:
        raise HTTPException(400, f"{label.capitalize()} deve ter no máximo {maximum} caracteres")
    return result


def validate_day(value: int, label: str) -> int:
    if not 1 <= value <= 31:
        raise HTTPException(400, f"{label.capitalize()} deve estar entre 1 e 31")
    return value


def validate_transaction(data: "TransactionInput") -> tuple[str, str, str, str]:
    description = clean_text(data.description, "uma descrição", 2, 120)
    category = clean_text(data.category, "uma categoria", 2, 60)
    account = clean_text(data.account, "uma conta ou cartão", 2, 80)
    if abs(data.value) < 0.005:
        raise HTTPException(400, "O valor precisa ser diferente de zero")
    if data.status not in {"Pago", "Recebido", "Pendente"}:
        raise HTTPException(400, "Status inválido")
    try:
        parsed = parse_br_date(data.date)
    except ValueError:
        raise HTTPException(400, "Data inválida")
    if data.recurring_end:
        try:
            recurring_end = date.fromisoformat(data.recurring_end)
        except ValueError:
            raise HTTPException(400, "Data final da recorrência inválida")
        if recurring_end < parsed:
            raise HTTPException(400, "A recorrência não pode terminar antes do primeiro lançamento")
    return description, category, account, parsed.isoformat()


class Login(BaseModel):
    username: str
    password: str


class Register(BaseModel):
    name: str
    username: str
    password: str


class TransactionInput(BaseModel):
    date: str
    description: str
    category: str
    account: str
    value: float
    status: str
    shared: bool = False
    group_id: int | None = None
    recurring: bool = False
    recurring_day: int | None = None
    recurring_end: str | None = None
    split_user_ids: list[int] | None = None
    family_ids: list[int] = []


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


class ProfileUpdate(BaseModel):
    name: str
    username: str


class GroupUpdate(BaseModel):
    name: str


class CategoryUpdate(BaseModel):
    enabled: bool


class MemberAdd(BaseModel):
    username: str


class RecurringUpdate(BaseModel):
    active: bool


class AccountInput(BaseModel):
    bank: str
    account_type: str
    balance: float = 0
    color: str = "#1468ff"
    family_ids: list[int] = []


class CardInput(BaseModel):
    bank: str
    ending: str
    close_day: int
    due_day: int
    credit_limit: float = 0
    current_invoice: float = 0
    color: str = "blue"
    family_ids: list[int] = []


class InvitationAnswer(BaseModel):
    accept: bool


def current_user(session: str | None) -> sqlite3.Row:
    if not session:
        raise HTTPException(401, "Não autenticado")
    with connection() as db:
        row = db.execute(
            """SELECT users.id,users.username,users.name
               FROM sessions JOIN users ON users.id=sessions.user_id
               WHERE sessions.token=? AND sessions.expires_at>?""",
            (session, datetime.now(timezone.utc).isoformat()),
        ).fetchone()
    if not row:
        raise HTTPException(401, "Sessão inválida")
    return row


def ensure_member(db: sqlite3.Connection, group_id: int, user_id: int) -> sqlite3.Row:
    row = db.execute(
        """SELECT groups.id,groups.name,groups.owner_id,group_members.role
           FROM groups JOIN group_members ON group_members.group_id=groups.id
           WHERE groups.id=? AND group_members.user_id=?""",
        (group_id, user_id),
    ).fetchone()
    if not row:
        raise HTTPException(403, "Você não participa deste grupo")
    return row


def ensure_family_member(db: sqlite3.Connection, family_id: int, user_id: int) -> sqlite3.Row:
    row = db.execute(
        """SELECT families.id,families.name,families.owner_id,family_members.role
           FROM families JOIN family_members ON family_members.family_id=families.id
           WHERE families.id=? AND family_members.user_id=?""",
        (family_id, user_id),
    ).fetchone()
    if not row:
        raise HTTPException(403, "Você não participa desta família")
    return row


def validate_family_ids(db: sqlite3.Connection, user_id: int, family_ids: list[int]) -> list[int]:
    unique_ids = list(dict.fromkeys(family_ids))
    for family_id in unique_ids:
        ensure_family_member(db, family_id, user_id)
    return unique_ids


def sync_shares(
    db: sqlite3.Connection,
    table: str,
    item_column: str,
    item_id: int,
    family_ids: list[int],
) -> None:
    db.execute(f"DELETE FROM {table} WHERE {item_column}=?", (item_id,))
    db.executemany(
        f"INSERT INTO {table}({item_column},family_id) VALUES(?,?)",
        [(item_id, family_id) for family_id in family_ids],
    )


def group_json(db: sqlite3.Connection, group: sqlite3.Row) -> dict:
    members = db.execute(
        """SELECT users.id,users.name,users.username,group_members.role
           FROM group_members JOIN users ON users.id=group_members.user_id
           WHERE group_members.group_id=? ORDER BY group_members.role DESC,users.name""",
        (group["id"],),
    ).fetchall()
    categories = db.execute(
        "SELECT category,enabled FROM group_categories WHERE group_id=? ORDER BY rowid",
        (group["id"],),
    ).fetchall()
    return {
        "id": group["id"], "name": group["name"], "role": group["role"],
        "members": [dict(row) for row in members],
        "categories": {row["category"]: bool(row["enabled"]) for row in categories},
    }


def family_json(db: sqlite3.Connection, family: sqlite3.Row) -> dict:
    members = db.execute(
        """SELECT users.id,users.name,users.username,family_members.role
           FROM family_members JOIN users ON users.id=family_members.user_id
           WHERE family_members.family_id=? ORDER BY family_members.role DESC,users.name""",
        (family["id"],),
    ).fetchall()
    return {
        "id": family["id"],
        "name": family["name"],
        "role": family["role"],
        "members": [dict(row) for row in members],
    }


def parse_br_date(value: str) -> date:
    return datetime.strptime(value, "%d/%m/%Y").date()


def month_iterator(start: date, end: date):
    year, month = start.year, start.month
    count = 0
    while (year, month) <= (end.year, end.month) and count < 240:
        yield year, month
        month += 1
        if month == 13:
            month, year = 1, year + 1
        count += 1


def materialize_recurring(db: sqlite3.Connection, user_id: int) -> None:
    rules = db.execute(
        """SELECT DISTINCT recurring_rules.*
           FROM recurring_rules
           LEFT JOIN group_members ON group_members.group_id=recurring_rules.group_id
           WHERE recurring_rules.active=1
             AND (
                recurring_rules.user_id=?
                OR group_members.user_id=?
                OR recurring_rules.id IN (
                    SELECT recurring_family_shares.rule_id
                    FROM recurring_family_shares
                    JOIN family_members ON family_members.family_id=recurring_family_shares.family_id
                    WHERE family_members.user_id=?
                )
             )""",
        (user_id, user_id, user_id),
    ).fetchall()
    today = date.today()
    for rule in rules:
        start = date.fromisoformat(rule["start_date"])
        end = min(today, date.fromisoformat(rule["end_date"])) if rule["end_date"] else today
        for year, month in month_iterator(start, end):
            day = min(rule["day_of_month"], calendar.monthrange(year, month)[1])
            occurrence = date(year, month, day)
            if occurrence < start or occurrence > end:
                continue
            key = f"rule:{rule['id']}:{year:04d}-{month:02d}"
            if db.execute(
                "SELECT 1 FROM recurring_exclusions WHERE rule_id=? AND occurrence_key=?",
                (rule["id"], key),
            ).fetchone():
                continue
            db.execute(
                """INSERT OR IGNORE INTO transactions
                   (user_id,date,description,category,account,value,shared,status,group_id,recurring_rule_id,recurring_key)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    rule["user_id"], occurrence.strftime("%d/%m/%Y"), rule["description"],
                    rule["category"], rule["account"], rule["value"], int(rule["group_id"] is not None),
                    rule["status"], rule["group_id"], rule["id"], key,
                ),
            )
            transaction = db.execute("SELECT id FROM transactions WHERE recurring_key=?", (key,)).fetchone()
            if transaction:
                family_ids = [
                    row["family_id"]
                    for row in db.execute("SELECT family_id FROM recurring_family_shares WHERE rule_id=?", (rule["id"],))
                ]
                sync_shares(db, "transaction_family_shares", "transaction_id", transaction["id"], family_ids)


def rebuild_splits(db: sqlite3.Connection, transaction_id: int, group_id: int | None, value: float, user_ids: list[int] | None) -> None:
    db.execute("DELETE FROM transaction_splits WHERE transaction_id=?", (transaction_id,))
    if not group_id or value >= 0:
        return
    members = db.execute("SELECT user_id FROM group_members WHERE group_id=? ORDER BY user_id", (group_id,)).fetchall()
    valid = {row["user_id"] for row in members}
    selected = [item for item in (user_ids or list(valid)) if item in valid]
    if not selected:
        selected = list(valid)
    amount = round(abs(value) / len(selected), 2)
    remaining = round(abs(value), 2)
    for index, member_id in enumerate(selected):
        share = remaining if index == len(selected) - 1 else amount
        db.execute("INSERT INTO transaction_splits(transaction_id,user_id,amount) VALUES(?,?,?)", (transaction_id, member_id, share))
        remaining = round(remaining - share, 2)


def transaction_row(db: sqlite3.Connection, transaction_id: int, viewer_id: int) -> dict:
    row = db.execute(
        """SELECT transactions.id,transactions.user_id,date,description,category,users.name person,
                  account,value,shared,status,transactions.group_id,groups.name group_name,
                  transactions.recurring_rule_id,
                  (SELECT amount FROM transaction_splits WHERE transaction_id=transactions.id AND user_id=?) split_amount
           FROM transactions JOIN users ON users.id=transactions.user_id
           LEFT JOIN groups ON groups.id=transactions.group_id
           WHERE transactions.id=?""",
        (viewer_id, transaction_id),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Lançamento não encontrado")
    result = dict(row)
    result["shared"] = bool(row["shared"])
    result["recurring"] = row["recurring_rule_id"] is not None
    result["editable"] = row["user_id"] == viewer_id
    family_rows = db.execute(
        """SELECT families.id,families.name
           FROM transaction_family_shares
           JOIN families ON families.id=transaction_family_shares.family_id
           WHERE transaction_family_shares.transaction_id=? ORDER BY families.name""",
        (transaction_id,),
    ).fetchall()
    result["family_ids"] = [item["id"] for item in family_rows]
    result["family_names"] = [item["name"] for item in family_rows]
    return result


def owned_item_row(db: sqlite3.Connection, table: str, item_id: int, viewer_id: int) -> dict:
    row = db.execute(
        f"""SELECT {table}.*,users.name owner_name
            FROM {table} JOIN users ON users.id={table}.user_id
            WHERE {table}.id=?""",
        (item_id,),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Item não encontrado")
    share_table = "account_family_shares" if table == "accounts" else "card_family_shares"
    item_column = "account_id" if table == "accounts" else "card_id"
    shares = db.execute(
        f"""SELECT families.id,families.name FROM {share_table}
            JOIN families ON families.id={share_table}.family_id
            WHERE {share_table}.{item_column}=? ORDER BY families.name""",
        (item_id,),
    ).fetchall()
    result = dict(row)
    result["editable"] = row["user_id"] == viewer_id
    result["family_ids"] = [item["id"] for item in shares]
    result["family_names"] = [item["name"] for item in shares]
    return result


@app.post("/api/login")
def login(data: Login, response: Response):
    with connection() as db:
        user = db.execute("SELECT * FROM users WHERE username=?", (data.username.strip(),)).fetchone()
        if not user or not password_valid(data.password, user["password_hash"]):
            raise HTTPException(401, "Usuário ou senha incorretos")
        token = secrets.token_urlsafe(32)
        expires = datetime.now(timezone.utc) + timedelta(days=30)
        db.execute("DELETE FROM sessions WHERE expires_at<=?", (datetime.now(timezone.utc).isoformat(),))
        db.execute("INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)", (token, user["id"], expires.isoformat()))
    response.set_cookie("session", token, httponly=True, samesite="lax", max_age=2_592_000)
    return {"id": user["id"], "name": user["name"], "username": user["username"]}


@app.post("/api/register")
def register(data: Register, response: Response):
    name = clean_text(data.name, "seu nome", 2, 80)
    username = data.username.strip().lower()
    if not re.fullmatch(r"[a-z0-9._-]{3,32}", username):
        raise HTTPException(400, "Use de 3 a 32 caracteres: letras, números, ponto, hífen ou sublinhado")
    if len(data.password) < 8:
        raise HTTPException(400, "A senha precisa ter pelo menos 8 caracteres")
    try:
        with connection() as db:
            user_id = db.execute(
                "INSERT INTO users(username,name,password_hash) VALUES(?,?,?)",
                (username, name, password_hash(data.password)),
            ).lastrowid
            token = secrets.token_urlsafe(32)
            expires = datetime.now(timezone.utc) + timedelta(days=30)
            db.execute("INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)", (token, user_id, expires.isoformat()))
    except sqlite3.IntegrityError:
        raise HTTPException(409, "Este usuário já está em uso")
    response.set_cookie("session", token, httponly=True, samesite="lax", max_age=2_592_000)
    return {"id": user_id, "name": name, "username": username}


@app.post("/api/logout")
def logout(response: Response, session: str | None = Cookie(default=None)):
    if session:
        with connection() as db:
            db.execute("DELETE FROM sessions WHERE token=?", (session,))
    response.delete_cookie("session")
    return {"ok": True}


@app.get("/api/me")
def me(session: str | None = Cookie(default=None)):
    user = current_user(session)
    return {"id": user["id"], "name": user["name"], "username": user["username"]}


@app.put("/api/me")
def update_profile(data: ProfileUpdate, session: str | None = Cookie(default=None)):
    user = current_user(session)
    name, username = clean_text(data.name, "seu nome", 2, 80), data.username.strip().lower()
    if not re.fullmatch(r"[a-z0-9._-]{3,32}", username):
        raise HTTPException(400, "Usuário inválido")
    try:
        with connection() as db:
            db.execute("UPDATE users SET name=?,username=? WHERE id=?", (name, username, user["id"]))
    except sqlite3.IntegrityError:
        raise HTTPException(409, "Este usuário já está em uso")
    return {"id": user["id"], "name": name, "username": username}


@app.post("/api/me/password")
def change_password(data: PasswordChange, session: str | None = Cookie(default=None)):
    user = current_user(session)
    if len(data.new_password) < 8:
        raise HTTPException(400, "A nova senha precisa ter pelo menos 8 caracteres")
    with connection() as db:
        stored = db.execute("SELECT password_hash FROM users WHERE id=?", (user["id"],)).fetchone()[0]
        if not password_valid(data.current_password, stored):
            raise HTTPException(400, "Senha atual incorreta")
        db.execute("UPDATE users SET password_hash=? WHERE id=?", (password_hash(data.new_password), user["id"]))
        db.execute("DELETE FROM sessions WHERE user_id=? AND token<>?", (user["id"], session))
    return {"ok": True}


@app.get("/api/transactions")
def get_transactions(
    scope: str = Query(default="all", pattern="^(all|mine|group|family)$"),
    group_id: int | None = None,
    family_id: int | None = None,
    session: str | None = Cookie(default=None),
):
    user = current_user(session)
    with connection() as db:
        materialize_recurring(db, user["id"])
        if scope == "mine":
            where, params = "transactions.user_id=?", [user["id"]]
        elif scope == "group":
            if not group_id:
                where, params = "0", []
            else:
                ensure_member(db, group_id, user["id"])
                where, params = "transactions.group_id=?", [group_id]
        elif scope == "family":
            if not family_id:
                where, params = "0", []
            else:
                ensure_family_member(db, family_id, user["id"])
                where = """(transactions.user_id=? OR transactions.id IN
                            (SELECT transaction_id FROM transaction_family_shares WHERE family_id=?))"""
                params = [user["id"], family_id]
        else:
            where = """(transactions.user_id=? OR transactions.group_id IN
                        (SELECT group_id FROM group_members WHERE user_id=?)
                        OR transactions.id IN (
                            SELECT transaction_family_shares.transaction_id
                            FROM transaction_family_shares
                            JOIN family_members ON family_members.family_id=transaction_family_shares.family_id
                            WHERE family_members.user_id=?
                        ))"""
            params = [user["id"], user["id"], user["id"]]
        rows = db.execute(
            f"""SELECT transactions.id FROM transactions
                WHERE {where}
                ORDER BY substr(date,7,4) DESC,substr(date,4,2) DESC,substr(date,1,2) DESC,transactions.id DESC""",
            params,
        ).fetchall()
        return [transaction_row(db, row["id"], user["id"]) for row in rows]


@app.post("/api/transactions")
def create_transaction(data: TransactionInput, session: str | None = Cookie(default=None)):
    user = current_user(session)
    description, category, account, start_iso = validate_transaction(data)
    with connection() as db:
        group_id = data.group_id if data.shared else None
        if group_id:
            ensure_member(db, group_id, user["id"])
        family_ids = validate_family_ids(db, user["id"], data.family_ids)
        rule_id = None
        if data.recurring:
            start = date.fromisoformat(start_iso)
            recurring_day = max(1, min(data.recurring_day or start.day, 31))
            rule_id = db.execute(
                """INSERT INTO recurring_rules
                   (user_id,group_id,description,category,account,value,day_of_month,start_date,end_date,status)
                   VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (user["id"], group_id, description, category, account, data.value,
                 recurring_day, start.isoformat(), data.recurring_end or None, "Pendente"),
            ).lastrowid
            sync_shares(db, "recurring_family_shares", "rule_id", rule_id, family_ids)
        transaction_id = db.execute(
            """INSERT INTO transactions
               (user_id,date,description,category,account,value,shared,status,group_id,recurring_rule_id,recurring_key)
               VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
            (user["id"], data.date, description, category, account, data.value,
             int(group_id is not None), data.status, group_id, rule_id,
             f"rule:{rule_id}:{parse_br_date(data.date).strftime('%Y-%m')}" if rule_id else None),
        ).lastrowid
        rebuild_splits(db, transaction_id, group_id, data.value, data.split_user_ids)
        sync_shares(db, "transaction_family_shares", "transaction_id", transaction_id, family_ids)
        return transaction_row(db, transaction_id, user["id"])


@app.put("/api/transactions/{transaction_id}")
def update_transaction(transaction_id: int, data: TransactionInput, session: str | None = Cookie(default=None)):
    user = current_user(session)
    description, category, account, _ = validate_transaction(data)
    with connection() as db:
        current = db.execute("SELECT user_id FROM transactions WHERE id=?", (transaction_id,)).fetchone()
        if not current or current["user_id"] != user["id"]:
            raise HTTPException(403, "Você só pode editar seus próprios lançamentos")
        group_id = data.group_id if data.shared else None
        if group_id:
            ensure_member(db, group_id, user["id"])
        family_ids = validate_family_ids(db, user["id"], data.family_ids)
        db.execute(
            """UPDATE transactions SET date=?,description=?,category=?,account=?,value=?,
               shared=?,status=?,group_id=? WHERE id=?""",
            (data.date, description, category, account, data.value,
             int(group_id is not None), data.status, group_id, transaction_id),
        )
        rebuild_splits(db, transaction_id, group_id, data.value, data.split_user_ids)
        sync_shares(db, "transaction_family_shares", "transaction_id", transaction_id, family_ids)
        return transaction_row(db, transaction_id, user["id"])


@app.delete("/api/transactions/{transaction_id}")
def delete_transaction(transaction_id: int, session: str | None = Cookie(default=None)):
    user = current_user(session)
    with connection() as db:
        row = db.execute(
            "SELECT user_id,recurring_rule_id,recurring_key FROM transactions WHERE id=?",
            (transaction_id,),
        ).fetchone()
        if not row or row["user_id"] != user["id"]:
            raise HTTPException(403, "Você só pode excluir seus próprios lançamentos")
        if row["recurring_rule_id"] and row["recurring_key"]:
            db.execute(
                "INSERT OR IGNORE INTO recurring_exclusions(rule_id,occurrence_key) VALUES(?,?)",
                (row["recurring_rule_id"], row["recurring_key"]),
            )
        db.execute("DELETE FROM transactions WHERE id=?", (transaction_id,))
    return {"ok": True}


@app.get("/api/recurring")
def get_recurring(session: str | None = Cookie(default=None)):
    user = current_user(session)
    with connection() as db:
        rows = db.execute(
            """SELECT recurring_rules.*,groups.name group_name
               FROM recurring_rules LEFT JOIN groups ON groups.id=recurring_rules.group_id
               WHERE recurring_rules.user_id=? ORDER BY recurring_rules.id DESC""",
            (user["id"],),
        ).fetchall()
    return [dict(row) | {"active": bool(row["active"])} for row in rows]


@app.patch("/api/recurring/{rule_id}")
def update_recurring(rule_id: int, data: RecurringUpdate, session: str | None = Cookie(default=None)):
    user = current_user(session)
    with connection() as db:
        result = db.execute("UPDATE recurring_rules SET active=? WHERE id=? AND user_id=?", (int(data.active), rule_id, user["id"]))
        if result.rowcount == 0:
            raise HTTPException(404, "Lançamento fixo não encontrado")
    return {"ok": True}


@app.delete("/api/recurring/{rule_id}")
def delete_recurring(rule_id: int, session: str | None = Cookie(default=None)):
    user = current_user(session)
    with connection() as db:
        rule = db.execute("SELECT id FROM recurring_rules WHERE id=? AND user_id=?", (rule_id, user["id"])).fetchone()
        if not rule:
            raise HTTPException(404, "Lançamento fixo não encontrado")
        db.execute("UPDATE transactions SET recurring_rule_id=NULL,recurring_key=NULL WHERE recurring_rule_id=?", (rule_id,))
        db.execute("DELETE FROM recurring_rules WHERE id=?", (rule_id,))
    return {"ok": True}


@app.get("/api/accounts")
def get_accounts(
    include_family: bool = False,
    family_id: int | None = None,
    session: str | None = Cookie(default=None),
):
    user = current_user(session)
    with connection() as db:
        if include_family and family_id:
            ensure_family_member(db, family_id, user["id"])
            rows = db.execute(
                """SELECT DISTINCT accounts.id FROM accounts
                   LEFT JOIN account_family_shares ON account_family_shares.account_id=accounts.id
                   WHERE accounts.user_id=? OR account_family_shares.family_id=?
                   ORDER BY accounts.id DESC""",
                (user["id"], family_id),
            ).fetchall()
        else:
            rows = db.execute("SELECT id FROM accounts WHERE user_id=? ORDER BY id DESC", (user["id"],)).fetchall()
        return [owned_item_row(db, "accounts", row["id"], user["id"]) for row in rows]


@app.post("/api/accounts")
def create_account(data: AccountInput, session: str | None = Cookie(default=None)):
    user = current_user(session)
    bank = clean_text(data.bank, "o nome da conta", 2, 80)
    account_type = clean_text(data.account_type, "o tipo da conta", 2, 60)
    with connection() as db:
        family_ids = validate_family_ids(db, user["id"], data.family_ids)
        item_id = db.execute(
            "INSERT INTO accounts(user_id,bank,account_type,balance,color) VALUES(?,?,?,?,?)",
            (user["id"], bank, account_type, data.balance, data.color),
        ).lastrowid
        sync_shares(db, "account_family_shares", "account_id", item_id, family_ids)
        return owned_item_row(db, "accounts", item_id, user["id"])


@app.put("/api/accounts/{account_id}")
def update_account(account_id: int, data: AccountInput, session: str | None = Cookie(default=None)):
    user = current_user(session)
    bank = clean_text(data.bank, "o nome da conta", 2, 80)
    account_type = clean_text(data.account_type, "o tipo da conta", 2, 60)
    with connection() as db:
        owner = db.execute("SELECT user_id FROM accounts WHERE id=?", (account_id,)).fetchone()
        if not owner or owner["user_id"] != user["id"]:
            raise HTTPException(403, "Você só pode editar suas próprias contas")
        family_ids = validate_family_ids(db, user["id"], data.family_ids)
        db.execute(
            "UPDATE accounts SET bank=?,account_type=?,balance=?,color=? WHERE id=?",
            (bank, account_type, data.balance, data.color, account_id),
        )
        sync_shares(db, "account_family_shares", "account_id", account_id, family_ids)
        return owned_item_row(db, "accounts", account_id, user["id"])


@app.delete("/api/accounts/{account_id}")
def delete_account(account_id: int, session: str | None = Cookie(default=None)):
    user = current_user(session)
    with connection() as db:
        result = db.execute("DELETE FROM accounts WHERE id=? AND user_id=?", (account_id, user["id"]))
        if result.rowcount == 0:
            raise HTTPException(404, "Conta não encontrada")
    return {"ok": True}


@app.get("/api/cards")
def get_cards(
    include_family: bool = False,
    family_id: int | None = None,
    session: str | None = Cookie(default=None),
):
    user = current_user(session)
    with connection() as db:
        if include_family and family_id:
            ensure_family_member(db, family_id, user["id"])
            rows = db.execute(
                """SELECT DISTINCT cards.id FROM cards
                   LEFT JOIN card_family_shares ON card_family_shares.card_id=cards.id
                   WHERE cards.user_id=? OR card_family_shares.family_id=?
                   ORDER BY cards.id DESC""",
                (user["id"], family_id),
            ).fetchall()
        else:
            rows = db.execute("SELECT id FROM cards WHERE user_id=? ORDER BY id DESC", (user["id"],)).fetchall()
        return [owned_item_row(db, "cards", row["id"], user["id"]) for row in rows]


@app.post("/api/cards")
def create_card(data: CardInput, session: str | None = Cookie(default=None)):
    user = current_user(session)
    bank = clean_text(data.bank, "o nome do cartão", 2, 80)
    close_day = validate_day(data.close_day, "o dia de fechamento")
    due_day = validate_day(data.due_day, "o dia de vencimento")
    if not re.fullmatch(r"\d{4}", data.ending):
        raise HTTPException(400, "Informe os quatro últimos números do cartão")
    if data.credit_limit < 0 or data.current_invoice < 0:
        raise HTTPException(400, "Limite e fatura não podem ser negativos")
    with connection() as db:
        family_ids = validate_family_ids(db, user["id"], data.family_ids)
        item_id = db.execute(
            """INSERT INTO cards(user_id,bank,ending,close_day,due_day,credit_limit,current_invoice,color)
               VALUES(?,?,?,?,?,?,?,?)""",
            (user["id"], bank, data.ending, close_day, due_day,
             data.credit_limit, data.current_invoice, data.color),
        ).lastrowid
        sync_shares(db, "card_family_shares", "card_id", item_id, family_ids)
        return owned_item_row(db, "cards", item_id, user["id"])


@app.put("/api/cards/{card_id}")
def update_card(card_id: int, data: CardInput, session: str | None = Cookie(default=None)):
    user = current_user(session)
    bank = clean_text(data.bank, "o nome do cartão", 2, 80)
    close_day = validate_day(data.close_day, "o dia de fechamento")
    due_day = validate_day(data.due_day, "o dia de vencimento")
    if not re.fullmatch(r"\d{4}", data.ending):
        raise HTTPException(400, "Informe os quatro últimos números do cartão")
    if data.credit_limit < 0 or data.current_invoice < 0:
        raise HTTPException(400, "Limite e fatura não podem ser negativos")
    with connection() as db:
        owner = db.execute("SELECT user_id FROM cards WHERE id=?", (card_id,)).fetchone()
        if not owner or owner["user_id"] != user["id"]:
            raise HTTPException(403, "Você só pode editar seus próprios cartões")
        family_ids = validate_family_ids(db, user["id"], data.family_ids)
        db.execute(
            """UPDATE cards SET bank=?,ending=?,close_day=?,due_day=?,credit_limit=?,
               current_invoice=?,color=? WHERE id=?""",
            (bank, data.ending, close_day, due_day,
             data.credit_limit, data.current_invoice, data.color, card_id),
        )
        sync_shares(db, "card_family_shares", "card_id", card_id, family_ids)
        return owned_item_row(db, "cards", card_id, user["id"])


@app.delete("/api/cards/{card_id}")
def delete_card(card_id: int, session: str | None = Cookie(default=None)):
    user = current_user(session)
    with connection() as db:
        result = db.execute("DELETE FROM cards WHERE id=? AND user_id=?", (card_id, user["id"]))
        if result.rowcount == 0:
            raise HTTPException(404, "Cartão não encontrado")
    return {"ok": True}


@app.get("/api/families")
def get_families(session: str | None = Cookie(default=None)):
    user = current_user(session)
    with connection() as db:
        families = db.execute(
            """SELECT families.*,family_members.role
               FROM family_members JOIN families ON families.id=family_members.family_id
               WHERE family_members.user_id=? ORDER BY families.name""",
            (user["id"],),
        ).fetchall()
        return [family_json(db, family) for family in families]


@app.post("/api/families")
def create_family(data: GroupUpdate, session: str | None = Cookie(default=None)):
    user = current_user(session)
    name = clean_text(data.name, "um nome para a família", 2, 80)
    with connection() as db:
        family_id = db.execute("INSERT INTO families(name,owner_id) VALUES(?,?)", (name, user["id"])).lastrowid
        db.execute("INSERT INTO family_members(family_id,user_id,role) VALUES(?,?,'owner')", (family_id, user["id"]))
        family = ensure_family_member(db, family_id, user["id"])
        return family_json(db, family)


@app.put("/api/families/{family_id}")
def update_family(family_id: int, data: GroupUpdate, session: str | None = Cookie(default=None)):
    user = current_user(session)
    name = clean_text(data.name, "um nome para a família", 2, 80)
    with connection() as db:
        family = ensure_family_member(db, family_id, user["id"])
        if family["role"] != "owner":
            raise HTTPException(403, "Somente o administrador pode editar a família")
        db.execute("UPDATE families SET name=? WHERE id=?", (name, family_id))
    return {"ok": True}


@app.delete("/api/families/{family_id}")
def delete_family(family_id: int, session: str | None = Cookie(default=None)):
    user = current_user(session)
    with connection() as db:
        family = ensure_family_member(db, family_id, user["id"])
        if family["role"] != "owner":
            raise HTTPException(403, "Somente o administrador pode apagar a família")
        db.execute("DELETE FROM families WHERE id=?", (family_id,))
    return {"ok": True}


@app.get("/api/family-invitations")
def get_family_invitations(session: str | None = Cookie(default=None)):
    user = current_user(session)
    with connection() as db:
        rows = db.execute(
            """SELECT family_invitations.id,families.name family_name,users.name invited_by_name
               FROM family_invitations
               JOIN families ON families.id=family_invitations.family_id
               JOIN users ON users.id=family_invitations.invited_by
               WHERE family_invitations.invited_user_id=? AND family_invitations.status='pending'
               ORDER BY family_invitations.id DESC""",
            (user["id"],),
        ).fetchall()
    return [dict(row) for row in rows]


@app.post("/api/families/{family_id}/invitations")
def invite_family_member(family_id: int, data: MemberAdd, session: str | None = Cookie(default=None)):
    user = current_user(session)
    with connection() as db:
        family = ensure_family_member(db, family_id, user["id"])
        if family["role"] != "owner":
            raise HTTPException(403, "Somente o administrador pode convidar pessoas")
        invited = db.execute("SELECT id,name,username FROM users WHERE username=?", (data.username.strip(),)).fetchone()
        if not invited:
            raise HTTPException(404, "Usuário não encontrado")
        if db.execute("SELECT 1 FROM family_members WHERE family_id=? AND user_id=?", (family_id, invited["id"])).fetchone():
            raise HTTPException(409, "Esta pessoa já participa da família")
        if db.execute(
            "SELECT 1 FROM family_invitations WHERE family_id=? AND invited_user_id=? AND status='pending'",
            (family_id, invited["id"]),
        ).fetchone():
            raise HTTPException(409, "Já existe um convite pendente para esta pessoa")
        invitation_id = db.execute(
            "INSERT INTO family_invitations(family_id,invited_user_id,invited_by) VALUES(?,?,?)",
            (family_id, invited["id"], user["id"]),
        ).lastrowid
    return {"id": invitation_id, "name": invited["name"], "username": invited["username"]}


@app.patch("/api/family-invitations/{invitation_id}")
def answer_family_invitation(invitation_id: int, data: InvitationAnswer, session: str | None = Cookie(default=None)):
    user = current_user(session)
    with connection() as db:
        invitation = db.execute(
            """SELECT * FROM family_invitations
               WHERE id=? AND invited_user_id=? AND status='pending'""",
            (invitation_id, user["id"]),
        ).fetchone()
        if not invitation:
            raise HTTPException(404, "Convite não encontrado")
        status = "accepted" if data.accept else "declined"
        db.execute("UPDATE family_invitations SET status=? WHERE id=?", (status, invitation_id))
        if data.accept:
            db.execute(
                "INSERT OR IGNORE INTO family_members(family_id,user_id,role) VALUES(?,?,'member')",
                (invitation["family_id"], user["id"]),
            )
    return {"ok": True}


@app.delete("/api/families/{family_id}/members/{member_id}")
def remove_family_member(family_id: int, member_id: int, session: str | None = Cookie(default=None)):
    user = current_user(session)
    with connection() as db:
        family = ensure_family_member(db, family_id, user["id"])
        if member_id == family["owner_id"]:
            raise HTTPException(400, "O administrador deve apagar a família")
        if user["id"] != member_id and family["role"] != "owner":
            raise HTTPException(403, "Você não pode remover esta pessoa")
        db.execute("DELETE FROM family_members WHERE family_id=? AND user_id=?", (family_id, member_id))
    return {"ok": True}


@app.get("/api/groups")
def get_groups(session: str | None = Cookie(default=None)):
    user = current_user(session)
    with connection() as db:
        groups = db.execute(
            """SELECT groups.*,group_members.role
               FROM group_members JOIN groups ON groups.id=group_members.group_id
               WHERE group_members.user_id=? ORDER BY groups.name""",
            (user["id"],),
        ).fetchall()
        return [group_json(db, group) for group in groups]


@app.get("/api/groups/{group_id}")
def get_group(group_id: int, session: str | None = Cookie(default=None)):
    user = current_user(session)
    with connection() as db:
        group = ensure_member(db, group_id, user["id"])
        return group_json(db, group)


@app.post("/api/groups")
def create_group(data: GroupUpdate, session: str | None = Cookie(default=None)):
    user = current_user(session)
    name = clean_text(data.name, "um nome para o grupo", 2, 80)
    with connection() as db:
        group_id = db.execute("INSERT INTO groups(name,owner_id) VALUES(?,?)", (name, user["id"])).lastrowid
        db.execute("INSERT INTO group_members(group_id,user_id,role) VALUES(?,?,'owner')", (group_id, user["id"]))
        seed_categories(db, group_id)
        group = ensure_member(db, group_id, user["id"])
        return group_json(db, group)


@app.put("/api/groups/{group_id}")
def update_group(group_id: int, data: GroupUpdate, session: str | None = Cookie(default=None)):
    user = current_user(session)
    name = clean_text(data.name, "um nome para o grupo", 2, 80)
    with connection() as db:
        group = ensure_member(db, group_id, user["id"])
        if group["role"] != "owner":
            raise HTTPException(403, "Somente o administrador pode editar o grupo")
        db.execute("UPDATE groups SET name=? WHERE id=?", (name, group_id))
    return {"ok": True}


@app.delete("/api/groups/{group_id}")
def delete_group(group_id: int, session: str | None = Cookie(default=None)):
    user = current_user(session)
    with connection() as db:
        group = ensure_member(db, group_id, user["id"])
        if group["role"] != "owner":
            raise HTTPException(403, "Somente o administrador pode apagar o grupo")
        db.execute("UPDATE recurring_rules SET group_id=NULL WHERE group_id=?", (group_id,))
        db.execute("UPDATE transactions SET shared=0,group_id=NULL WHERE group_id=?", (group_id,))
        db.execute("DELETE FROM groups WHERE id=?", (group_id,))
    return {"ok": True}


@app.get("/api/group-invitations")
def get_group_invitations(session: str | None = Cookie(default=None)):
    user = current_user(session)
    with connection() as db:
        rows = db.execute(
            """SELECT group_invitations.id,groups.name group_name,users.name invited_by_name
               FROM group_invitations
               JOIN groups ON groups.id=group_invitations.group_id
               JOIN users ON users.id=group_invitations.invited_by
               WHERE group_invitations.invited_user_id=? AND group_invitations.status='pending'
               ORDER BY group_invitations.id DESC""",
            (user["id"],),
        ).fetchall()
    return [dict(row) for row in rows]


@app.post("/api/groups/{group_id}/invitations")
def invite_group_member(group_id: int, data: MemberAdd, session: str | None = Cookie(default=None)):
    user = current_user(session)
    with connection() as db:
        group = ensure_member(db, group_id, user["id"])
        if group["role"] != "owner":
            raise HTTPException(403, "Somente o administrador pode convidar pessoas")
        invited = db.execute("SELECT id,name,username FROM users WHERE username=?", (data.username.strip(),)).fetchone()
        if not invited:
            raise HTTPException(404, "Usuário não encontrado")
        if db.execute("SELECT 1 FROM group_members WHERE group_id=? AND user_id=?", (group_id, invited["id"])).fetchone():
            raise HTTPException(409, "Esta pessoa já participa do grupo")
        if db.execute(
            "SELECT 1 FROM group_invitations WHERE group_id=? AND invited_user_id=? AND status='pending'",
            (group_id, invited["id"]),
        ).fetchone():
            raise HTTPException(409, "Já existe um convite pendente para esta pessoa")
        invitation_id = db.execute(
            "INSERT INTO group_invitations(group_id,invited_user_id,invited_by) VALUES(?,?,?)",
            (group_id, invited["id"], user["id"]),
        ).lastrowid
    return {"id": invitation_id, "name": invited["name"], "username": invited["username"]}


@app.patch("/api/group-invitations/{invitation_id}")
def answer_group_invitation(invitation_id: int, data: InvitationAnswer, session: str | None = Cookie(default=None)):
    user = current_user(session)
    with connection() as db:
        invitation = db.execute(
            "SELECT * FROM group_invitations WHERE id=? AND invited_user_id=? AND status='pending'",
            (invitation_id, user["id"]),
        ).fetchone()
        if not invitation:
            raise HTTPException(404, "Convite não encontrado")
        db.execute(
            "UPDATE group_invitations SET status=? WHERE id=?",
            ("accepted" if data.accept else "declined", invitation_id),
        )
        if data.accept:
            db.execute(
                "INSERT OR IGNORE INTO group_members(group_id,user_id,role) VALUES(?,?,'member')",
                (invitation["group_id"], user["id"]),
            )
    return {"ok": True}


@app.post("/api/groups/{group_id}/members")
def add_member(group_id: int, data: MemberAdd, session: str | None = Cookie(default=None)):
    user = current_user(session)
    with connection() as db:
        group = ensure_member(db, group_id, user["id"])
        if group["role"] != "owner":
            raise HTTPException(403, "Somente o administrador pode adicionar participantes")
        member = db.execute("SELECT id,name,username FROM users WHERE username=?", (data.username.strip(),)).fetchone()
        if not member:
            raise HTTPException(404, "Usuário não encontrado")
        try:
            db.execute("INSERT INTO group_members(group_id,user_id,role) VALUES(?,?,'member')", (group_id, member["id"]))
        except sqlite3.IntegrityError:
            raise HTTPException(409, "Esta pessoa já participa do grupo")
    return dict(member) | {"role": "member"}


@app.delete("/api/groups/{group_id}/members/{member_id}")
def remove_member(group_id: int, member_id: int, session: str | None = Cookie(default=None)):
    user = current_user(session)
    with connection() as db:
        group = ensure_member(db, group_id, user["id"])
        if group["role"] != "owner":
            raise HTTPException(403, "Somente o administrador pode remover participantes")
        if member_id == user["id"]:
            raise HTTPException(400, "O administrador deve apagar o grupo para sair")
        db.execute("UPDATE recurring_rules SET group_id=NULL WHERE group_id=? AND user_id=?", (group_id, member_id))
        db.execute("UPDATE transactions SET shared=0,group_id=NULL WHERE group_id=? AND user_id=?", (group_id, member_id))
        db.execute("DELETE FROM group_members WHERE group_id=? AND user_id=?", (group_id, member_id))
    return {"ok": True}


@app.patch("/api/groups/{group_id}/categories/{category}")
def update_category(group_id: int, category: str, data: CategoryUpdate, session: str | None = Cookie(default=None)):
    user = current_user(session)
    with connection() as db:
        group = ensure_member(db, group_id, user["id"])
        if group["role"] != "owner":
            raise HTTPException(403, "Somente o administrador pode alterar categorias")
        db.execute(
            """INSERT INTO group_categories(group_id,category,enabled) VALUES(?,?,?)
               ON CONFLICT(group_id,category) DO UPDATE SET enabled=excluded.enabled""",
            (group_id, category, int(data.enabled)),
        )
    return {"ok": True}


@app.get("/api/health")
def health():
    return {"status": "ok", "database": str(DB_PATH)}

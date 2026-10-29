from getpass import getpass

from backend.main import connection, password_hash

username = input("Usuário: ").strip().lower()
password = getpass("Nova senha: ")
confirmation = getpass("Repita a nova senha: ")

if len(password) < 8:
    raise SystemExit("A senha precisa ter pelo menos 8 caracteres.")
if password != confirmation:
    raise SystemExit("As senhas não conferem.")

with connection() as db:
    result = db.execute(
        "UPDATE users SET password_hash=? WHERE username=?",
        (password_hash(password), username),
    )
    if result.rowcount == 0:
        raise SystemExit("Usuário não encontrado.")

print("Senha alterada com sucesso.")

"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Page = "Visão geral" | "Lançamentos" | "Contas" | "Cartões" | "Grupos" | "Família" | "Relatórios" | "Perfil";
type Person = string;

type Transaction = {
  id: number;
  user_id: number;
  date: string;
  description: string;
  category: string;
  person: Person;
  account: string;
  value: number;
  shared: boolean;
  status: "Pago" | "Recebido" | "Pendente";
  group_id: number | null;
  group_name: string | null;
  recurring: boolean;
  recurring_rule_id: number | null;
  editable: boolean;
  split_amount: number | null;
  family_ids: number[];
  family_names: string[];
};

type Group = {
  id: number;
  name: string;
  role: string;
  members: { id: number; name: string; username: string; role: string }[];
  categories: Record<string, boolean>;
};

type RecurringRule = {
  id: number;
  description: string;
  category: string;
  account: string;
  value: number;
  day_of_month: number;
  group_name: string | null;
  active: boolean;
};

type Family = {
  id: number;
  name: string;
  role: string;
  members: { id: number; name: string; username: string; role: string }[];
};

type Account = {
  id: number;
  user_id: number;
  bank: string;
  account_type: string;
  balance: number;
  color: string;
  owner_name: string;
  editable: boolean;
  family_ids: number[];
  family_names: string[];
};

type Card = {
  id: number;
  user_id: number;
  bank: string;
  ending: string;
  close_day: number;
  due_day: number;
  credit_limit: number;
  current_invoice: number;
  color: string;
  owner_name: string;
  editable: boolean;
  family_ids: number[];
  family_names: string[];
};

const categoryColors: Record<string, string> = {
  Moradia: "#1468ff",
  Alimentação: "#60a5fa",
  Transporte: "#2dd4bf",
  Lazer: "#8b5cf6",
  Receita: "#22c55e",
};
const chartPalette = ["#1468ff", "#60a5fa", "#2dd4bf", "#8b5cf6", "#f59e0b", "#ef4444"];

function chartGradient(items: { value: number; color: string }[]) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (!total) return "conic-gradient(#1c2a43 0 100%)";
  let start = 0;
  const stops = items.map((item) => {
    const end = start + item.value / total * 100;
    const stop = `${item.color} ${start}% ${end}%`;
    start = end;
    return stop;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

const parseMoney = (value: FormDataEntryValue | null) =>
  Number(String(value ?? "0").replace(/\./g, "").replace(",", "."));

const brToIso = (value: string) => {
  const [day, month, year] = value.split("/");
  return `${year}-${month}-${day}`;
};

const currentMonth = () => new Date().toISOString().slice(0, 7);

const monthLabel = (value: string) => {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" })
    .format(new Date(year, month - 1, 1))
    .replace(/^./, (letter) => letter.toUpperCase());
};

const shiftMonth = (value: string, amount: number) => {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(year, month - 1 + amount, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

const transactionMonth = (value: string) => {
  const [day, month, year] = value.split("/");
  return day && month && year ? `${year}-${month}` : "";
};

export default function Home() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingLogin, setCheckingLogin] = useState(true);
  const [page, setPage] = useState<Page>("Visão geral");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [person, setPerson] = useState<Person>("Usuário");
  const [userId, setUserId] = useState(0);
  const [username, setUsername] = useState("");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionModal, setTransactionModal] = useState<Transaction | "new" | null>(null);
  const [inviteGroup, setInviteGroup] = useState<Group | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [families, setFamilies] = useState<Family[]>([]);
  const [ownedAccounts, setOwnedAccounts] = useState<Account[]>([]);
  const [ownedCards, setOwnedCards] = useState<Card[]>([]);
  const [selectedFamilyId, setSelectedFamilyId] = useState<number | null>(null);
  const [dashboardMode, setDashboardMode] = useState<"mine" | "group" | "family">("mine");
  const [toast, setToast] = useState("");
  const [period, setPeriod] = useState(currentMonth());

  useEffect(() => {
    const saved = localStorage.getItem("finance-theme");
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);

  useEffect(() => {
    localStorage.setItem("finance-theme", theme);
  }, [theme]);

  async function loadOwnedAssets() {
    const [accountsResponse, cardsResponse] = await Promise.all([
      fetch("/api/accounts", { credentials: "include" }),
      fetch("/api/cards", { credentials: "include" }),
    ]);
    if (accountsResponse.ok) setOwnedAccounts(await accountsResponse.json());
    if (cardsResponse.ok) setOwnedCards(await cardsResponse.json());
  }

  useEffect(() => {
    fetch("/api/me", { credentials: "include" })
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((data) => {
        setUserId(data.id);
        setPerson(data.name);
        setUsername(data.username);
        setAuthenticated(true);
        return Promise.all([
          fetch("/api/transactions", { credentials: "include" }).then((response) => response.json()),
          fetch("/api/groups", { credentials: "include" }).then((response) => response.json()),
          fetch("/api/families", { credentials: "include" }).then((response) => response.json()),
          fetch("/api/accounts", { credentials: "include" }).then((response) => response.json()),
          fetch("/api/cards", { credentials: "include" }).then((response) => response.json()),
        ]);
      })
      .then((data) => {
        if (!data) return;
        setTransactions(data[0]);
        setGroups(data[1]);
        setSelectedGroupId(data[1][0]?.id ?? null);
        setFamilies(data[2]);
        setSelectedFamilyId(data[2][0]?.id ?? null);
        setOwnedAccounts(data[3]);
        setOwnedCards(data[4]);
      })
      .catch(() => setAuthenticated(false))
      .finally(() => setCheckingLogin(false));
  }, []);

  const selectedGroup = groups.find((group) => group.id === selectedGroupId);
  const selectedFamily = families.find((family) => family.id === selectedFamilyId);
  const dashboardTransactions = transactions.filter((item) => {
    if (transactionMonth(item.date) !== period) return false;
    if (item.user_id === userId) return true;
    if (dashboardMode === "group") return selectedGroupId !== null && item.group_id === selectedGroupId;
    if (dashboardMode === "family") return selectedFamilyId !== null && item.family_ids.includes(selectedFamilyId);
    return false;
  });
  const income = dashboardTransactions.filter((item) => item.value > 0).reduce((sum, item) => sum + item.value, 0);
  const expenses = Math.abs(dashboardTransactions.filter((item) => item.value < 0).reduce((sum, item) => sum + item.value, 0));
  const balance = income - expenses;

  const categories = useMemo(() => {
    const totals = new Map<string, number>();
    dashboardTransactions.filter((item) => item.value < 0).forEach((item) => totals.set(item.category, (totals.get(item.category) ?? 0) + Math.abs(item.value)));
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [dashboardTransactions]);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  async function loadTransactions(scope = "all", groupId?: number | null, familyId?: number | null) {
    const query = new URLSearchParams({ scope });
    if (groupId) query.set("group_id", String(groupId));
    if (familyId) query.set("family_id", String(familyId));
    const response = await fetch(`/api/transactions?${query}`, { credentials: "include" });
    if (response.ok) setTransactions(await response.json());
  }

  async function saveTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const type = String(form.get("type"));
    const rawValue = parseMoney(form.get("value"));
    const groupId = Number(form.get("group_id")) || null;
    const editing = transactionModal !== null && transactionModal !== "new";
    const payload = {
      date: new Date(`${form.get("date")}T12:00:00`).toLocaleDateString("pt-BR"),
      description: String(form.get("description")),
      category: String(form.get("category")),
      account: String(form.get("account")),
      value: type === "Receita" ? rawValue : -rawValue,
      shared: Boolean(groupId),
      group_id: groupId,
      status: String(form.get("status")),
      recurring: !editing && form.get("recurring") === "on",
      recurring_day: Number(form.get("recurring_day")) || undefined,
      recurring_end: String(form.get("recurring_end") || "") || undefined,
      split_user_ids: form.getAll("split_user_ids").map(Number),
      family_ids: form.getAll("family_ids").map(Number),
    };
    const response = await fetch(editing ? `/api/transactions/${transactionModal.id}` : "/api/transactions", {
      method: editing ? "PUT" : "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      showToast(error?.detail ?? "Não foi possível salvar o lançamento");
      return;
    }
    setTransactionModal(null);
    await loadTransactions();
    showToast(editing ? "Lançamento atualizado" : "Lançamento adicionado com sucesso");
  }

  if (checkingLogin) return <div className="login-screen"><div className="login-card"><div className="brand-mark">◆</div><h1>Finanças Compartilhadas</h1><p>Carregando seu espaço financeiro...</p></div></div>;
  if (!authenticated) return <LoginScreen onLogin={(id, name, user) => { setUserId(id); setPerson(name); setUsername(user); setAuthenticated(true); loadTransactions(); loadOwnedAssets(); Promise.all([fetch("/api/groups", { credentials: "include" }).then((r) => r.json()), fetch("/api/families", { credentials: "include" }).then((r) => r.json())]).then(([groupItems, familyItems]) => { setGroups(groupItems); setSelectedGroupId(groupItems[0]?.id ?? null); setFamilies(familyItems); setSelectedFamilyId(familyItems[0]?.id ?? null); }); }} />;
  const headerContext = page === "Grupos"
    ? selectedGroup?.name ?? "Meus grupos"
    : page === "Família"
      ? selectedFamily?.name ?? "Modo família"
      : `Espaço pessoal · ${person}`;

  return (
    <div className={theme === "dark" ? "app dark" : "app light"}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">◆</div>
          <div><strong>Finanças</strong><span>Compartilhadas</span></div>
        </div>
        <nav>
          {(["Visão geral", "Lançamentos", "Contas", "Cartões", "Grupos", "Família", "Relatórios", "Perfil"] as Page[]).map((item, index) => (
            <button key={item} className={page === item ? "nav-item active" : "nav-item"} onClick={() => setPage(item)}>
              <span className="nav-icon">{["⌂", "⇄", "▣", "▭", "♧", "♚", "▥", "●"][index]}</span>{item}
            </button>
          ))}
        </nav>
        <div className="month-summary">
          <div className="summary-head"><span>Resumo do mês</span><span>▦</span></div>
          <small>{monthLabel(period)}</small>
          <strong>{money(balance)}</strong>
          <span className="blue-text">{dashboardTransactions.length} lançamento(s)</span>
          <small>{income ? `${Math.round(expenses / income * 100)}% da receita utilizada` : "Sem receitas no período"}</small>
        </div>
        <div className="user-switch">
          <button onClick={() => setPage("Perfil")}>
            <span className={`avatar ${person.toLowerCase()}`}>{person[0]}</span>
            <span><strong>{person}</strong><small>Perfil e segurança</small></span>
            <b>⌄</b>
          </button>
        </div>
      </aside>

      <main>
        <header>
          <button className="group-picker" onClick={() => setPage(page === "Família" ? "Família" : page === "Grupos" ? "Grupos" : "Visão geral")}><span>⌂</span> {headerContext} <b>⌄</b></button>
          <div className="header-actions">
            <button className="theme-toggle" aria-label="Alternar tema" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              <span>{theme === "dark" ? "☾" : "☀"}</span><i className={theme} />
            </button>
            <button className="primary-button" onClick={() => setTransactionModal("new")}>＋ Novo lançamento</button>
          </div>
        </header>

        <div className="content">
          {page === "Visão geral" && <Dashboard person={person} groups={groups} selectedGroupId={selectedGroupId} setSelectedGroupId={setSelectedGroupId} families={families} selectedFamilyId={selectedFamilyId} setSelectedFamilyId={setSelectedFamilyId} mode={dashboardMode} setMode={setDashboardMode} balance={balance} income={income} expenses={expenses} categories={categories} transactions={dashboardTransactions} period={period} setPeriod={setPeriod} onAdd={() => setTransactionModal("new")} onOpenTransactions={() => setPage("Lançamentos")} />}
          {page === "Lançamentos" && <TransactionsPage transactions={transactions} groups={groups} families={families} selectedGroupId={selectedGroupId} selectedFamilyId={selectedFamilyId} setSelectedGroupId={setSelectedGroupId} setSelectedFamilyId={setSelectedFamilyId} onScopeChange={loadTransactions} onAdd={() => setTransactionModal("new")} onEdit={setTransactionModal} onChanged={() => loadTransactions()} onToast={showToast} />}
          {page === "Contas" && <AccountsPage families={families} selectedFamilyId={selectedFamilyId} setSelectedFamilyId={setSelectedFamilyId} onToast={showToast} onChanged={loadOwnedAssets} />}
          {page === "Cartões" && <CardsPage families={families} selectedFamilyId={selectedFamilyId} setSelectedFamilyId={setSelectedFamilyId} onToast={showToast} onChanged={loadOwnedAssets} />}
          {page === "Grupos" && <GroupsPage currentUser={person} groups={groups} setGroups={setGroups} selectedGroupId={selectedGroupId} setSelectedGroupId={setSelectedGroupId} onInvite={setInviteGroup} onToast={showToast} onChanged={() => loadTransactions()} />}
          {page === "Família" && <FamilyPage currentUserId={userId} families={families} setFamilies={setFamilies} selectedFamilyId={selectedFamilyId} setSelectedFamilyId={setSelectedFamilyId} onToast={showToast} onChanged={() => loadTransactions()} />}
          {page === "Relatórios" && <ReportsPage categories={categories} expenses={expenses} />}
          {page === "Perfil" && <ProfilePage name={person} username={username} onUpdated={(name, user) => { setPerson(name); setUsername(user); }} onLogout={async () => { await fetch("/api/logout", { method: "POST", credentials: "include" }); setAuthenticated(false); }} onToast={showToast} />}
        </div>
      </main>

      {transactionModal && <TransactionModal transaction={transactionModal === "new" ? null : transactionModal} groups={groups} families={families} accounts={ownedAccounts} cards={ownedCards} onClose={() => setTransactionModal(null)} onSubmit={saveTransaction} />}
      {inviteGroup && <InviteModal group={inviteGroup} onClose={() => setInviteGroup(null)} onSent={(name) => { setInviteGroup(null); showToast(`Convite enviado para ${name}`); }} />}
      {toast && <div className="toast">✓ {toast}</div>}
    </div>
  );
}

function LoginScreen({ onLogin }: { onLogin: (id: number, name: Person, username: string) => void }) {
  const [error, setError] = useState("");
  const [registering, setRegistering] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(registering ? "/api/register" : "/api/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.get("name"), username: form.get("username"), password: form.get("password") }),
    });
    if (!response.ok) {
      setError((await response.json()).detail ?? "Não foi possível continuar.");
      return;
    }
    const data = await response.json();
    onLogin(data.id, data.name, data.username);
  }
  return <div className="login-screen"><div className="login-card">
    <div className="brand-mark">◆</div>
    <p className="login-eyebrow">CONTROLE INDIVIDUAL E PRIVADO</p>
    <h1>{registering ? "Criar minha conta" : "Finanças Compartilhadas"}</h1>
    <p>{registering ? "Comece com um espaço financeiro somente seu." : "Acesse seu espaço financeiro com segurança."}</p>
    <div className="login-tabs"><button className={!registering ? "active" : ""} onClick={() => { setRegistering(false); setError(""); }}>Entrar</button><button className={registering ? "active" : ""} onClick={() => { setRegistering(true); setError(""); }}>Criar conta</button></div>
    <form onSubmit={submit}>
      {registering && <label>Nome<input name="name" autoComplete="name" required placeholder="Seu nome" /></label>}
      <label>Usuário<input name="username" autoComplete="username" required placeholder="Escolha seu usuário" /></label>
      <PasswordField name="password" label="Senha" placeholder="Sua senha" autoComplete="current-password" />
      {error && <div className="login-error">{error}</div>}
      <button className="primary-button">{registering ? "Criar conta e entrar" : "Entrar"}</button>
    </form>
    <small>Os dados ficam armazenados somente no computador principal.</small>
  </div></div>;
}

function Dashboard({ person, groups, selectedGroupId, setSelectedGroupId, families, selectedFamilyId, setSelectedFamilyId, mode, setMode, balance, income, expenses, categories, transactions, period, setPeriod, onAdd, onOpenTransactions }: {
  person: string;
  groups: Group[]; selectedGroupId: number | null; setSelectedGroupId: (id: number | null) => void;
  families: Family[]; selectedFamilyId: number | null; setSelectedFamilyId: (id: number | null) => void;
  mode: "mine" | "group" | "family"; setMode: (mode: "mine" | "group" | "family") => void;
  balance: number; income: number; expenses: number; categories: [string, number][]; transactions: Transaction[];
  period: string; setPeriod: (value: string) => void;
  onAdd: () => void; onOpenTransactions: () => void;
}) {
  const people = [...new Set(transactions.map((item) => item.person))].map((name) => ({
    name,
    value: Math.abs(transactions.filter((item) => item.value < 0 && item.person === name).reduce((sum, item) => sum + item.value, 0)),
  }));
  const peopleTotal = people.reduce((sum, item) => sum + item.value, 0);
  const categoryChart = chartGradient(categories.map(([name, value], index) => ({ value, color: categoryColors[name] ?? chartPalette[index % chartPalette.length] })));
  const peopleChart = chartGradient(people.map((item, index) => ({ value: item.value, color: chartPalette[index % chartPalette.length] })));
  const contextName = mode === "group"
    ? groups.find((item) => item.id === selectedGroupId)?.name
    : families.find((item) => item.id === selectedFamilyId)?.name;
  return <>
    <div className="page-title dashboard-title"><div><p>{mode === "mine" ? "Seu controle individual" : `${mode === "family" ? "Família" : "Grupo"} · ${contextName ?? "selecione"}`}</p><h1>Olá, {person}</h1><span className="page-subtitle">Acompanhe o que entrou, o que saiu e o que precisa da sua atenção.</span></div>
      <div className="view-selector"><span>Visualização da tela inicial</span>
        <button className={mode === "mine" ? "active" : ""} onClick={() => setMode("mine")}>Só meus valores</button>
        <label className={mode === "group" ? "context-choice active" : "context-choice"}><button type="button" disabled={!groups.length} onClick={() => setMode("group")}>Grupo</button><select value={selectedGroupId ?? ""} disabled={!groups.length} onChange={(event) => { setSelectedGroupId(Number(event.target.value)); setMode("group"); }}>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        <label className={mode === "family" ? "context-choice active" : "context-choice"}><button type="button" disabled={!families.length} onClick={() => setMode("family")}>Família</button><select value={selectedFamilyId ?? ""} disabled={!families.length} onChange={(event) => { setSelectedFamilyId(Number(event.target.value)); setMode("family"); }}>{families.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}</select></label>
      </div>
    </div>
    <div className="dashboard-toolbar">
      <div className="month-control"><button aria-label="Mês anterior" onClick={() => setPeriod(shiftMonth(period, -1))}>‹</button><strong>{monthLabel(period)}</strong><button aria-label="Próximo mês" onClick={() => setPeriod(shiftMonth(period, 1))}>›</button>{period !== currentMonth() && <button className="today-button" onClick={() => setPeriod(currentMonth())}>Mês atual</button>}</div>
      <div className="quick-actions"><button className="secondary-button" onClick={onOpenTransactions}>Ver lançamentos</button><button className="primary-button" onClick={onAdd}>＋ Adicionar</button></div>
    </div>
    <section className="kpi-grid">
      <Kpi title={mode === "mine" ? "Meu resultado" : "Resultado consolidado"} value={money(balance)} change="no período selecionado" icon="▣" />
      <Kpi title="Receitas" value={money(income)} change={`${transactions.filter((item) => item.value > 0).length} recebimento(s)`} icon="↗" />
      <Kpi title="Despesas" value={money(expenses)} change={`${transactions.filter((item) => item.value < 0).length} pagamento(s)`} icon="↓" negative />
    </section>
    <section className="analytics-grid">
      <article className="panel category-panel">
        <div className="panel-head"><div><h2>Gastos por categoria</h2><p>{monthLabel(period)}</p></div></div>
        <div className="category-content">
          <div className="donut" style={{ background: categoryChart }}><div><small>Total</small><strong>{money(expenses)}</strong><span>100%</span></div></div>
          <div className="legend">{categories.length ? categories.map(([name, value], index) => <div key={name}><i style={{ background: categoryColors[name] ?? chartPalette[index % chartPalette.length] }} /><span>{name}</span><b>{money(value)}</b><em>{expenses ? Math.round(value / expenses * 100) : 0}%</em></div>) : <p className="helper">Nenhuma despesa neste modo de visualização.</p>}</div>
        </div>
      </article>
      <article className="panel member-panel">
        <div className="panel-head"><h2>Distribuição por membro</h2></div>
        <div className="member-content">
          <div className="donut member" style={{ background: peopleChart }}><div><strong>{money(peopleTotal)}</strong><span>Total</span></div></div>
          <div className="member-list">
            {people.map((item, index) => <div key={item.name}><i className="dot" style={{ background: chartPalette[index % chartPalette.length] }} /><span>{item.name}</span><b>{money(item.value)}</b></div>)}
          </div>
        </div>
      </article>
    </section>
    <TransactionTable transactions={transactions.slice(0, 6)} title="Lançamentos recentes" />
  </>;
}

function Kpi({ title, value, change, icon, negative = false }: { title: string; value: string; change: string; icon: string; negative?: boolean }) {
  return <article className="kpi-card"><div className="kpi-icon">{icon}</div><div><span>{title} ⓘ</span><strong>{value}</strong><small className={negative ? "down" : ""}>{negative ? "↓" : "↑"} {change}</small></div><div className="sparkline"><i/><i/><i/><i/><i/></div></article>;
}

function TransactionsPage({ transactions, groups, families, selectedGroupId, selectedFamilyId, setSelectedGroupId, setSelectedFamilyId, onScopeChange, onAdd, onEdit, onChanged, onToast }: {
  transactions: Transaction[];
  groups: Group[];
  families: Family[];
  selectedGroupId: number | null;
  selectedFamilyId: number | null;
  setSelectedGroupId: (id: number | null) => void;
  setSelectedFamilyId: (id: number | null) => void;
  onScopeChange: (scope: string, groupId?: number | null, familyId?: number | null) => Promise<void>;
  onAdd: () => void;
  onEdit: (transaction: Transaction) => void;
  onChanged: () => Promise<void>;
  onToast: (message: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState("all");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [recurring, setRecurring] = useState<RecurringRule[]>([]);
  useEffect(() => { fetch("/api/recurring", { credentials: "include" }).then((response) => response.json()).then(setRecurring); }, [transactions]);
  const categoryOptions = [...new Set(transactions.map((item) => item.category))].sort();
  const filtered = transactions.filter((item) => {
    const text = `${item.description} ${item.account} ${item.person}`.toLowerCase();
    return text.includes(search.toLowerCase())
      && (!category || item.category === category)
      && (!status || item.status === status)
      && (!kind || (kind === "income" ? item.value > 0 : item.value < 0));
  });
  function exportCsv() {
    const rows = [["Data", "Descrição", "Categoria", "Conta", "Responsável", "Valor", "Status"], ...filtered.map((item) => [item.date, item.description, item.category, item.account, item.person, item.value.toFixed(2).replace(".", ","), item.status])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    link.download = `lancamentos-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }
  async function remove(item: Transaction) {
    if (!confirm(`Excluir o lançamento "${item.description}"?`)) return;
    const response = await fetch(`/api/transactions/${item.id}`, { method: "DELETE", credentials: "include" });
    if (response.ok) { await onChanged(); onToast("Lançamento excluído"); }
    else onToast((await response.json()).detail ?? "Não foi possível excluir");
  }
  return <><PageHeading eyebrow="Controle completo" title="Lançamentos" action="Novo lançamento" onAction={onAdd} />
    <div className="scope-tabs">
      <button className={scope === "all" ? "active" : ""} onClick={() => { setScope("all"); onScopeChange("all"); }}>Tudo que posso ver</button>
      <button className={scope === "mine" ? "active" : ""} onClick={() => { setScope("mine"); onScopeChange("mine"); }}>Apenas meus lançamentos</button>
      <button className={scope === "group" ? "active" : ""} disabled={!groups.length} onClick={() => { setScope("group"); onScopeChange("group", selectedGroupId); }}>Lançamentos do grupo</button>
      {scope === "group" && <select value={selectedGroupId ?? ""} onChange={(event) => { const id = Number(event.target.value); setSelectedGroupId(id); onScopeChange("group", id); }}>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>}
      <button className={scope === "family" ? "active" : ""} disabled={!families.length} onClick={() => { setScope("family"); onScopeChange("family", null, selectedFamilyId); }}>Visão da família</button>
      {scope === "family" && <select value={selectedFamilyId ?? ""} onChange={(event) => { const id = Number(event.target.value); setSelectedFamilyId(id); onScopeChange("family", null, id); }}>{families.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}</select>}
    </div>
    <div className="toolbar filters-toolbar"><input placeholder="Buscar descrição, conta ou pessoa" value={search} onChange={(e) => setSearch(e.target.value)} /><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Todas as categorias</option>{categoryOptions.map((item) => <option key={item}>{item}</option>)}</select><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="">Receitas e despesas</option><option value="expense">Despesas</option><option value="income">Receitas</option></select><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos os status</option><option>Pago</option><option>Recebido</option><option>Pendente</option></select><button className="secondary-button" onClick={exportCsv} disabled={!filtered.length}>Exportar CSV</button></div>
    <div className="results-summary"><span>{filtered.length} lançamento(s)</span>{(search || category || kind || status) && <button onClick={() => { setSearch(""); setCategory(""); setKind(""); setStatus(""); }}>Limpar filtros</button>}</div>
    <TransactionTable transactions={filtered} editable onEdit={onEdit} onDelete={remove} title="Lançamentos" />
    <RecurringPanel rules={recurring} setRules={setRecurring} onToast={onToast} />
  </>;
}

function TransactionTable({ transactions, editable = false, onEdit, onDelete, title = "Lançamentos" }: {
  transactions: Transaction[];
  editable?: boolean;
  onEdit?: (transaction: Transaction) => void;
  onDelete?: (transaction: Transaction) => void;
  title?: string;
}) {
  return <article className="panel transactions-panel">
    <div className="panel-head"><div><h2>{title}</h2><p>{transactions.length ? `${transactions.length} registro(s) nesta visão` : "Nenhum registro encontrado"}</p></div></div>
    {!transactions.length ? <div className="table-empty"><strong>Nenhum lançamento por aqui</strong><span>Altere os filtros ou adicione um novo lançamento.</span></div> :
    <div className="table-wrap"><table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Responsável</th><th>Destino</th><th>Valor</th><th>Status</th>{editable && <th>Ações</th>}</tr></thead>
    <tbody>{transactions.map((item) => <tr key={item.id}><td>{item.date}</td><td><strong>{item.description}</strong><small className="account-label">{item.account}</small>{item.recurring && <span className="fixed-badge">↻ Fixo</span>}</td><td><span className="tag" style={{ "--tag": categoryColors[item.category] ?? "#1468ff" } as React.CSSProperties}>{item.category}</span></td><td><span className={`mini-avatar ${item.person.toLowerCase()}`}>{item.person[0]}</span>{item.person}</td><td><div className="destination-tags">{item.group_name && <span className="group-badge">⌂ {item.group_name}</span>}{item.family_names.map((name) => <span className="family-badge" key={name}>♚ {name}</span>)}{!item.group_name && !item.family_names.length && "Pessoal"}</div>{item.split_amount != null && <small className="split-value">Sua parte: {money(item.split_amount)}</small>}</td><td className={item.value > 0 ? "positive" : "negative"}>{money(item.value)}</td><td><span className={`status ${item.status.toLowerCase()}`}>{item.status}</span></td>{editable && <td>{item.editable ? <div className="row-actions"><button onClick={() => onEdit?.(item)}>Editar</button><button className="danger-link" onClick={() => onDelete?.(item)}>Excluir</button></div> : <span className="helper">Somente leitura</span>}</td>}</tr>)}</tbody></table></div>}
  </article>;
}

function RecurringPanel({ rules, setRules, onToast }: { rules: RecurringRule[]; setRules: React.Dispatch<React.SetStateAction<RecurringRule[]>>; onToast: (message: string) => void }) {
  if (!rules.length) return <article className="panel recurring-panel"><div className="panel-head"><div><h2>Lançamentos fixos</h2><p>Marque “Repetir todo mês” ao criar um lançamento.</p></div></div><div className="recurring-empty">Nenhum pagamento ou recebimento fixo configurado.</div></article>;
  return <article className="panel recurring-panel"><div className="panel-head"><div><h2>Lançamentos fixos</h2><p>O sistema cria automaticamente uma ocorrência a cada mês.</p></div></div>
    <div className="recurring-list">{rules.map((rule) => <div key={rule.id}><div><strong>{rule.description}</strong><small>{rule.value > 0 ? "Recebimento" : "Pagamento"} · dia {rule.day_of_month} · {rule.group_name ?? "Pessoal"}</small></div><b className={rule.value > 0 ? "positive" : "negative"}>{money(rule.value)}</b><button className={`switch ${rule.active ? "on" : ""}`} title={rule.active ? "Pausar" : "Ativar"} onClick={async () => { const active = !rule.active; const response = await fetch(`/api/recurring/${rule.id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active }) }); if (response.ok) { setRules((items) => items.map((item) => item.id === rule.id ? { ...item, active } : item)); onToast(active ? "Recorrência ativada" : "Recorrência pausada"); } }}><i /></button><button className="danger-link" onClick={async () => { if (!confirm("Excluir esta recorrência? Os lançamentos já criados serão mantidos.")) return; const response = await fetch(`/api/recurring/${rule.id}`, { method: "DELETE", credentials: "include" }); if (response.ok) { setRules((items) => items.filter((item) => item.id !== rule.id)); onToast("Recorrência excluída"); } }}>Excluir regra</button></div>)}</div>
  </article>;
}

function AccountsPage({ families, selectedFamilyId, setSelectedFamilyId, onToast, onChanged }: { families: Family[]; selectedFamilyId: number | null; setSelectedFamilyId: (id: number | null) => void; onToast: (message: string) => void; onChanged: () => Promise<void> }) {
  const [items, setItems] = useState<Account[]>([]);
  const [familyView, setFamilyView] = useState(false);
  const [modal, setModal] = useState<Account | "new" | null>(null);
  async function load() {
    const query = familyView && selectedFamilyId ? `?include_family=true&family_id=${selectedFamilyId}` : "";
    const response = await fetch(`/api/accounts${query}`, { credentials: "include" });
    if (response.ok) setItems(await response.json());
  }
  useEffect(() => { load(); }, [familyView, selectedFamilyId]);
  async function remove(item: Account) {
    if (!confirm(`Excluir a conta ${item.bank}?`)) return;
    const response = await fetch(`/api/accounts/${item.id}`, { method: "DELETE", credentials: "include" });
    if (response.ok) { await load(); await onChanged(); onToast("Conta excluída"); }
  }
  return <><PageHeading eyebrow="Seu dinheiro por banco" title="Contas" action="Adicionar conta" onAction={() => setModal("new")} />
    <PrivacyToolbar familyView={familyView} setFamilyView={setFamilyView} families={families} selectedFamilyId={selectedFamilyId} setSelectedFamilyId={setSelectedFamilyId} itemName="contas" />
    {items.length ? <div className="cards-grid">{items.map((account) => <article className="bank-card" key={account.id}><div className="bank-logo" style={{ background: account.color }}>{account.bank[0]}</div><div className="bank-top"><div><h3>{account.bank}</h3><span>{account.account_type} · {account.owner_name}</span></div>{account.editable && <div className="row-actions"><button onClick={() => setModal(account)}>Editar</button><button className="danger-link" onClick={() => remove(account)}>Excluir</button></div>}</div><small>Saldo atual</small><strong>{money(account.balance)}</strong><div className="bank-footer"><span>{account.editable ? "Privacidade" : "Compartilhada por quem é dono"}</span><span className={account.family_names.length ? "status pago" : "status pendente"}>{account.family_names.length ? `Família: ${account.family_names.join(", ")}` : "Somente pessoal"}</span></div></article>)}</div> : <div className="empty-state"><h2>Nenhuma conta nesta visão</h2><p>Suas contas são privadas. Adicione uma conta ou escolha uma família que compartilhou informações com você.</p></div>}
    {modal && <AccountModal account={modal === "new" ? null : modal} families={families} onClose={() => setModal(null)} onSaved={async () => { setModal(null); await load(); await onChanged(); onToast("Conta salva"); }} />}
  </>;
}

function CardsPage({ families, selectedFamilyId, setSelectedFamilyId, onToast, onChanged }: { families: Family[]; selectedFamilyId: number | null; setSelectedFamilyId: (id: number | null) => void; onToast: (message: string) => void; onChanged: () => Promise<void> }) {
  const [items, setItems] = useState<Card[]>([]);
  const [familyView, setFamilyView] = useState(false);
  const [modal, setModal] = useState<Card | "new" | null>(null);
  async function load() {
    const query = familyView && selectedFamilyId ? `?include_family=true&family_id=${selectedFamilyId}` : "";
    const response = await fetch(`/api/cards${query}`, { credentials: "include" });
    if (response.ok) setItems(await response.json());
  }
  useEffect(() => { load(); }, [familyView, selectedFamilyId]);
  async function remove(item: Card) {
    if (!confirm(`Excluir o cartão ${item.bank} final ${item.ending}?`)) return;
    const response = await fetch(`/api/cards/${item.id}`, { method: "DELETE", credentials: "include" });
    if (response.ok) { await load(); await onChanged(); onToast("Cartão excluído"); }
  }
  return <><PageHeading eyebrow="Faturas e limites" title="Cartões" action="Adicionar cartão" onAction={() => setModal("new")} />
    <PrivacyToolbar familyView={familyView} setFamilyView={setFamilyView} families={families} selectedFamilyId={selectedFamilyId} setSelectedFamilyId={setSelectedFamilyId} itemName="cartões" />
    {items.length ? <div className="cards-grid">{items.map((card) => <article className={`credit-card ${card.color}`} key={card.id}><div className="card-top"><span>{card.bank}</span><b>•••• {card.ending}</b></div><small>Fatura atual</small><strong>{money(card.current_invoice)}</strong><div className="limit-line"><i style={{ width: `${card.credit_limit ? Math.min(card.current_invoice / card.credit_limit * 100, 100) : 0}%` }} /></div><div className="limit-values"><span>Disponível {money(card.credit_limit - card.current_invoice)}</span><span>Limite {money(card.credit_limit)}</span></div><div className="due-grid"><div><small>Fecha dia</small><b>{card.close_day}</b></div><div><small>Vence dia</small><b>{card.due_day}</b></div><div><small>Proprietário</small><b>{card.owner_name}</b></div></div>{card.editable ? <div className="card-actions"><button onClick={() => setModal(card)}>Editar</button><button onClick={() => remove(card)}>Excluir</button><span>{card.family_names.length ? `Compartilhado: ${card.family_names.join(", ")}` : "Somente pessoal"}</span></div> : <div className="card-actions"><span>Compartilhado por {card.owner_name}</span></div>}</article>)}</div> : <div className="empty-state"><h2>Nenhum cartão nesta visão</h2><p>Cartões só aparecem para o dono ou quando ele decide compartilhar com uma família.</p></div>}
    {modal && <CardModal card={modal === "new" ? null : modal} families={families} onClose={() => setModal(null)} onSaved={async () => { setModal(null); await load(); await onChanged(); onToast("Cartão salvo"); }} />}
  </>;
}

function PrivacyToolbar({ familyView, setFamilyView, families, selectedFamilyId, setSelectedFamilyId, itemName }: {
  familyView: boolean; setFamilyView: (value: boolean) => void; families: Family[];
  selectedFamilyId: number | null; setSelectedFamilyId: (id: number | null) => void; itemName: string;
}) {
  return <div className="privacy-toolbar"><div><strong>{familyView ? "Visão familiar" : `Meus ${itemName}`}</strong><small>{familyView ? "Mostra os seus dados e somente o que outras pessoas compartilharam." : "Nenhuma outra pessoa consegue ver estes dados por padrão."}</small></div><button className={!familyView ? "active" : ""} onClick={() => setFamilyView(false)}>Somente meus</button><button className={familyView ? "active" : ""} disabled={!families.length} onClick={() => setFamilyView(true)}>Ver família</button>{familyView && <select value={selectedFamilyId ?? ""} onChange={(event) => setSelectedFamilyId(Number(event.target.value))}>{families.map((family) => <option value={family.id} key={family.id}>{family.name}</option>)}</select>}</div>;
}

function FamilyShareFields({ families, selectedIds }: { families: Family[]; selectedIds: number[] }) {
  if (!families.length) return <p className="helper">Você ainda não participa de uma família. O item continuará privado.</p>;
  return <div className="family-share-box"><strong>Compartilhar com família</strong><small>Nada é compartilhado automaticamente. Marque somente onde este item poderá ser visto.</small><div>{families.map((family) => <label key={family.id}><input type="checkbox" name="family_ids" value={family.id} defaultChecked={selectedIds.includes(family.id)} />{family.name}</label>)}</div></div>;
}

function AccountModal({ account, families, onClose, onSaved }: { account: Account | null; families: Family[]; onClose: () => void; onSaved: () => void }) {
  const [error, setError] = useState("");
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal small" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span>Propriedade individual</span><h2>{account ? "Editar minha conta" : "Adicionar minha conta"}</h2></div><button onClick={onClose}>×</button></div><form onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const payload = { bank: form.get("bank"), account_type: form.get("account_type"), balance: parseMoney(form.get("balance")), color: form.get("color"), family_ids: form.getAll("family_ids").map(Number) }; const response = await fetch(account ? `/api/accounts/${account.id}` : "/api/accounts", { method: account ? "PUT" : "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); if (!response.ok) { setError((await response.json()).detail ?? "Não foi possível salvar"); return; } onSaved(); }}><div className="form-grid"><label className="wide">Banco ou instituição<input name="bank" required defaultValue={account?.bank} placeholder="Ex.: Nubank" /></label><label>Tipo de conta<input name="account_type" required defaultValue={account?.account_type ?? "Conta corrente"} /></label><label>Saldo atual<input name="balance" inputMode="decimal" required defaultValue={account?.balance.toFixed(2).replace(".", ",") ?? "0,00"} /></label><label className="wide">Cor de identificação<input name="color" type="color" defaultValue={account?.color ?? "#1468ff"} /></label></div><FamilyShareFields families={families} selectedIds={account?.family_ids ?? []} />{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button">Salvar conta</button></div></form></div></div>;
}

function CardModal({ card, families, onClose, onSaved }: { card: Card | null; families: Family[]; onClose: () => void; onSaved: () => void }) {
  const [error, setError] = useState("");
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span>Propriedade individual</span><h2>{card ? "Editar meu cartão" : "Adicionar meu cartão"}</h2></div><button onClick={onClose}>×</button></div><form onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const payload = { bank: form.get("bank"), ending: form.get("ending"), close_day: Number(form.get("close_day")), due_day: Number(form.get("due_day")), credit_limit: parseMoney(form.get("credit_limit")), current_invoice: parseMoney(form.get("current_invoice")), color: form.get("color"), family_ids: form.getAll("family_ids").map(Number) }; const response = await fetch(card ? `/api/cards/${card.id}` : "/api/cards", { method: card ? "PUT" : "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); if (!response.ok) { setError((await response.json()).detail ?? "Não foi possível salvar"); return; } onSaved(); }}><div className="form-grid"><label className="wide">Banco ou nome do cartão<input name="bank" required defaultValue={card?.bank} placeholder="Ex.: Nubank" /></label><label>Últimos 4 números<input name="ending" required minLength={4} maxLength={4} inputMode="numeric" defaultValue={card?.ending} /></label><label>Estilo<select name="color" defaultValue={card?.color ?? "blue"}><option value="blue">Azul</option><option value="violet">Roxo</option><option value="cyan">Ciano</option><option value="orange">Laranja</option><option value="green">Verde</option></select></label><label>Fecha dia<input name="close_day" type="number" min="1" max="31" required defaultValue={card?.close_day ?? 1} /></label><label>Vence dia<input name="due_day" type="number" min="1" max="31" required defaultValue={card?.due_day ?? 10} /></label><label>Limite<input name="credit_limit" inputMode="decimal" required defaultValue={card?.credit_limit.toFixed(2).replace(".", ",") ?? "0,00"} /></label><label>Fatura atual<input name="current_invoice" inputMode="decimal" required defaultValue={card?.current_invoice.toFixed(2).replace(".", ",") ?? "0,00"} /></label></div><FamilyShareFields families={families} selectedIds={card?.family_ids ?? []} />{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button">Salvar cartão</button></div></form></div></div>;
}

function GroupsPage({ currentUser, groups, setGroups, selectedGroupId, setSelectedGroupId, onInvite, onToast, onChanged }: {
  currentUser: string;
  groups: Group[];
  setGroups: React.Dispatch<React.SetStateAction<Group[]>>;
  selectedGroupId: number | null;
  setSelectedGroupId: (id: number | null) => void;
  onInvite: (group: Group) => void;
  onToast: (message: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [invitations, setInvitations] = useState<{ id: number; group_name: string; invited_by_name: string }[]>([]);
  const group = groups.find((item) => item.id === selectedGroupId) ?? groups[0] ?? null;
  useEffect(() => { if (!selectedGroupId && groups[0]) setSelectedGroupId(groups[0].id); }, [groups, selectedGroupId, setSelectedGroupId]);
  async function loadInvitations() { const response = await fetch("/api/group-invitations", { credentials: "include" }); if (response.ok) setInvitations(await response.json()); }
  async function reloadGroups() { const response = await fetch("/api/groups", { credentials: "include" }); if (response.ok) { const items = await response.json(); setGroups(items); if (!items.some((item: Group) => item.id === selectedGroupId)) setSelectedGroupId(items[0]?.id ?? null); } }
  async function answerInvitation(id: number, accept: boolean) { const response = await fetch(`/api/group-invitations/${id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accept }) }); if (response.ok) { await loadInvitations(); if (accept) { await reloadGroups(); await onChanged(); } onToast(accept ? "Convite do grupo aceito" : "Convite recusado"); } }
  useEffect(() => { loadInvitations(); }, []);
  const invitationPanel = invitations.length > 0 ? <article className="panel invitation-panel"><div className="panel-head"><div><h2>Convites para grupos</h2><p>Grupos compartilham somente os lançamentos criados para eles.</p></div></div>{invitations.map((invitation) => <div className="invitation-row" key={invitation.id}><div><strong>{invitation.group_name}</strong><small>Convite enviado por {invitation.invited_by_name}</small></div><button className="secondary-button" onClick={() => answerInvitation(invitation.id, false)}>Recusar</button><button className="primary-button" onClick={() => answerInvitation(invitation.id, true)}>Aceitar</button></div>)}</article> : null;
  if (!group || creating) return <>{invitationPanel}<div className="page-title"><div><p>Espaços compartilhados</p><h1>Novo grupo</h1></div>{groups.length > 0 && <button className="secondary-button" onClick={() => setCreating(false)}>Cancelar</button>}</div><CreateGroup onCreated={(created) => { setGroups((items) => [...items, created]); setSelectedGroupId(created.id); setCreating(false); onToast("Grupo criado"); }} /></>;
  const isOwner = group.role === "owner";
  async function rename(name: string) {
    const response = await fetch(`/api/groups/${group!.id}`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    if (response.ok) { setGroups((items) => items.map((item) => item.id === group!.id ? { ...item, name } : item)); setEditing(false); onToast("Nome do grupo atualizado"); }
  }
  async function removeMember(id: number) {
    if (!confirm("Remover esta pessoa do grupo? Os lançamentos pessoais dela continuarão preservados.")) return;
    const response = await fetch(`/api/groups/${group!.id}/members/${id}`, { method: "DELETE", credentials: "include" });
    if (response.ok) { setGroups((items) => items.map((item) => item.id === group!.id ? { ...item, members: item.members.filter((member) => member.id !== id) } : item)); onToast("Participante removido"); await onChanged(); }
  }
  async function deleteGroup() {
    if (!confirm("Apagar o grupo? Os lançamentos serão preservados, mas deixarão de ser compartilhados.")) return;
    const response = await fetch(`/api/groups/${group!.id}`, { method: "DELETE", credentials: "include" });
    if (response.ok) { const remaining = groups.filter((item) => item.id !== group!.id); setGroups(remaining); setSelectedGroupId(remaining[0]?.id ?? null); onToast("Grupo apagado"); await onChanged(); }
  }
  return <>{invitationPanel}<div className="page-title"><div><p>Compartilhamento sob controle</p>{editing ? <GroupNameEditor value={group.name} onSave={rename} onCancel={() => setEditing(false)} /> : <h1>{group.name}</h1>}</div><div className="page-actions"><button className="secondary-button" onClick={() => setCreating(true)}>＋ Criar grupo</button><button className="secondary-button" onClick={() => setEditing(true)} disabled={!isOwner}>Editar nome</button><button className="primary-button" onClick={() => onInvite(group)} disabled={!isOwner}>＋ Convidar pessoa</button></div></div>
    <div className="group-tabs">{groups.map((item) => <button key={item.id} className={item.id === group.id ? "active" : ""} onClick={() => { setSelectedGroupId(item.id); setEditing(false); }}>{item.name}<small>{item.members.length} pessoa(s)</small></button>)}</div>
    <div className="group-layout"><article className="panel group-info"><div className="group-cover"><div>⌂</div><h2>{group.name}</h2><p>Grupo personalizado · {group.members.length} participante(s)</p></div><div className="people">{group.members.map((member) => <div key={member.id}><span className={`avatar ${member.name.toLowerCase()}`}>{member.name[0]}</span><div><strong>{member.name}</strong><small>{member.role === "owner" ? "Administrador" : `@${member.username}`}</small></div>{member.name === currentUser ? <em>Você</em> : isOwner ? <button className="danger-link" onClick={() => removeMember(member.id)}>Remover</button> : <em>Ativo</em>}</div>)}</div>{isOwner && <div className="group-danger"><button onClick={deleteGroup}>Apagar grupo</button><small>Os lançamentos serão mantidos como pessoais.</small></div>}</article>
    <article className="panel sharing-settings"><div className="panel-head"><div><h2>Categorias do grupo</h2><p>{isOwner ? "Escolha quais categorias ficam disponíveis neste espaço." : "Somente o administrador pode alterar estas opções."}</p></div></div>{Object.entries(group.categories).map(([name, enabled]) => <div className="setting-row" key={name}><div><i style={{ background: categoryColors[name] ?? "#64748b" }} /><span>{name}</span></div><button disabled={!isOwner} className={`switch ${enabled ? "on" : ""}`} onClick={async () => { const next = !enabled; const response = await fetch(`/api/groups/${group.id}/categories/${encodeURIComponent(name)}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: next }) }); if (response.ok) setGroups((items) => items.map((item) => item.id === group.id ? { ...item, categories: { ...item.categories, [name]: next } } : item)); }}><i /></button></div>)}</article></div>
  </>;
}

function FamilyPage({ currentUserId, families, setFamilies, selectedFamilyId, setSelectedFamilyId, onToast, onChanged }: {
  currentUserId: number;
  families: Family[];
  setFamilies: React.Dispatch<React.SetStateAction<Family[]>>;
  selectedFamilyId: number | null;
  setSelectedFamilyId: (id: number | null) => void;
  onToast: (message: string) => void;
  onChanged: () => Promise<void>;
}) {
  type Invitation = { id: number; family_name: string; invited_by_name: string };
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [creating, setCreating] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const family = families.find((item) => item.id === selectedFamilyId) ?? families[0] ?? null;
  async function loadInvitations() {
    const response = await fetch("/api/family-invitations", { credentials: "include" });
    if (response.ok) setInvitations(await response.json());
  }
  async function reloadFamilies() {
    const response = await fetch("/api/families", { credentials: "include" });
    if (response.ok) {
      const items = await response.json();
      setFamilies(items);
      if (!items.some((item: Family) => item.id === selectedFamilyId)) setSelectedFamilyId(items[0]?.id ?? null);
    }
  }
  useEffect(() => { loadInvitations(); }, []);
  async function answer(invitationId: number, accept: boolean) {
    const response = await fetch(`/api/family-invitations/${invitationId}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accept }) });
    if (response.ok) { await loadInvitations(); if (accept) { await reloadFamilies(); await onChanged(); } onToast(accept ? "Convite aceito" : "Convite recusado"); }
  }
  async function removeMember(memberId: number) {
    if (!family || !confirm(memberId === currentUserId ? "Sair desta família?" : "Remover esta pessoa da família?")) return;
    const response = await fetch(`/api/families/${family.id}/members/${memberId}`, { method: "DELETE", credentials: "include" });
    if (response.ok) { await reloadFamilies(); await onChanged(); onToast(memberId === currentUserId ? "Você saiu da família" : "Pessoa removida"); }
  }
  async function deleteFamily() {
    if (!family || !confirm("Apagar esta família? Nenhum dado financeiro será apagado.")) return;
    const response = await fetch(`/api/families/${family.id}`, { method: "DELETE", credentials: "include" });
    if (response.ok) { await reloadFamilies(); await onChanged(); onToast("Família apagada"); }
  }
  const isOwner = family?.role === "owner";
  return <>
    {invitations.length > 0 && <article className="panel invitation-panel"><div className="panel-head"><div><h2>Convites recebidos</h2><p>Entrar em uma família não compartilha seus dados automaticamente.</p></div></div>{invitations.map((invitation) => <div className="invitation-row" key={invitation.id}><div><strong>{invitation.family_name}</strong><small>Convite enviado por {invitation.invited_by_name}</small></div><button className="secondary-button" onClick={() => answer(invitation.id, false)}>Recusar</button><button className="primary-button" onClick={() => answer(invitation.id, true)}>Aceitar</button></div>)}</article>}
    {(!family || creating) ? <><div className="page-title"><div><p>Compartilhamento seletivo</p><h1>Criar família</h1></div>{families.length > 0 && <button className="secondary-button" onClick={() => setCreating(false)}>Cancelar</button>}</div><div className="empty-state"><h2>Modo família opcional</h2><p>A família permite consolidar somente contas, cartões e lançamentos que cada proprietário escolher compartilhar.</p><form onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const response = await fetch("/api/families", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name") }) }); if (response.ok) { const created = await response.json(); setFamilies((items) => [...items, created]); setSelectedFamilyId(created.id); setCreating(false); onToast("Família criada"); } }}><input name="name" required placeholder="Ex.: Família Pimenta" /><button className="primary-button">Criar família</button></form></div></> : <>
      <div className="page-title"><div><p>Privacidade em primeiro lugar</p><h1>{family.name}</h1></div><div className="page-actions"><button className="secondary-button" onClick={() => setCreating(true)}>＋ Criar família</button>{isOwner && <button className="primary-button" onClick={() => document.getElementById("family-invite")?.focus()}>＋ Convidar pessoa</button>}</div></div>
      <div className="group-tabs">{families.map((item) => <button key={item.id} className={item.id === family.id ? "active" : ""} onClick={() => setSelectedFamilyId(item.id)}>{item.name}<small>{item.members.length} pessoa(s)</small></button>)}</div>
      <div className="family-layout"><article className="panel"><div className="family-cover"><span>♚</span><div><h2>{family.name}</h2><p>{family.members.length} participante(s) · compartilhamento seletivo</p></div></div><div className="people">{family.members.map((member) => <div key={member.id}><span className={`avatar ${member.name.toLowerCase()}`}>{member.name[0]}</span><div><strong>{member.name}</strong><small>{member.role === "owner" ? "Administrador" : `@${member.username}`}</small></div>{member.id === currentUserId && member.role !== "owner" ? <button className="danger-link" onClick={() => removeMember(member.id)}>Sair</button> : isOwner && member.id !== currentUserId ? <button className="danger-link" onClick={() => removeMember(member.id)}>Remover</button> : <em>{member.id === currentUserId ? "Você" : "Ativo"}</em>}</div>)}</div>{isOwner && <div className="group-danger"><button onClick={deleteFamily}>Apagar família</button><small>Os dados individuais permanecem intactos.</small></div>}</article>
      <article className="panel family-privacy"><div className="panel-head"><div><h2>Central de privacidade</h2><p>Cada pessoa controla exclusivamente os próprios dados.</p></div></div><div className="privacy-rule"><b>Contas</b><span>Privadas por padrão. O dono escolhe quais ficam visíveis.</span></div><div className="privacy-rule"><b>Cartões</b><span>Limite, fatura e vencimento só aparecem quando compartilhados.</span></div><div className="privacy-rule"><b>Lançamentos</b><span>Cada pagamento ou recebimento pode ser compartilhado separadamente.</span></div>{isOwner && <form className="family-invite-form" onSubmit={async (event) => { event.preventDefault(); setInviteError(""); const form = new FormData(event.currentTarget); const response = await fetch(`/api/families/${family.id}/invitations`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: form.get("username") }) }); if (!response.ok) { setInviteError((await response.json()).detail ?? "Não foi possível convidar"); return; } event.currentTarget.reset(); onToast("Convite de família enviado"); }}><label>Convidar pelo usuário<input id="family-invite" name="username" required placeholder="Ex.: marina" /></label>{inviteError && <div className="form-error">{inviteError}</div>}<button className="primary-button">Enviar convite</button></form>}</article></div>
    </>}
  </>;
}

function ReportsPage({ categories, expenses }: { categories: [string, number][]; expenses: number }) {
  const max = Math.max(...categories.map((item) => item[1]), 1);
  return <><PageHeading eyebrow="Análise financeira" title="Relatórios" action="Exportar relatório" /><div className="report-grid"><article className="panel bars"><div className="panel-head"><h2>Despesas por categoria</h2><select><option>Julho 2026</option></select></div>{categories.map(([name, value]) => <div className="bar-row" key={name}><div><span>{name}</span><b>{money(value)}</b></div><div><i style={{ width: `${value / max * 100}%`, background: categoryColors[name] }} /></div></div>)}</article><article className="panel insight"><span className="insight-icon">✦</span><h2>Resumo inteligente</h2><p>Alimentação é sua segunda maior categoria. Os gastos estão 8% acima da média dos últimos três meses.</p><div><span>Economia potencial</span><strong>{money(expenses * .08)}</strong></div></article></div></>;
}

function ProfilePage({ name, username, onUpdated, onLogout, onToast }: {
  name: string;
  username: string;
  onUpdated: (name: string, username: string) => void;
  onLogout: () => Promise<void>;
  onToast: (message: string) => void;
}) {
  const [profileError, setProfileError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = { name: String(form.get("name")), username: String(form.get("username")) };
    const response = await fetch("/api/me", { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!response.ok) { setProfileError((await response.json()).detail ?? "Não foi possível atualizar"); return; }
    const data = await response.json();
    onUpdated(data.name, data.username);
    setProfileError("");
    onToast("Perfil atualizado");
  }
  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("new_password"));
    if (newPassword !== String(form.get("confirmation"))) { setPasswordError("As novas senhas não conferem"); return; }
    const response = await fetch("/api/me/password", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current_password: form.get("current_password"), new_password: newPassword }) });
    if (!response.ok) { setPasswordError((await response.json()).detail ?? "Não foi possível alterar a senha"); return; }
    event.currentTarget.reset();
    setPasswordError("");
    onToast("Senha alterada com segurança");
  }
  return <><PageHeading eyebrow="Conta e segurança" title="Meu perfil" action="Sair da conta" onAction={onLogout} />
    <div className="profile-grid">
      <article className="panel profile-card"><div className="profile-hero"><span className={`avatar ${name.toLowerCase()}`}>{name[0]}</span><div><h2>{name}</h2><p>@{username}</p></div></div><form onSubmit={saveProfile}><label>Nome<input name="name" defaultValue={name} required /></label><label>Usuário de acesso<input name="username" defaultValue={username} required /></label>{profileError && <div className="form-error">{profileError}</div>}<button className="primary-button">Salvar perfil</button></form></article>
      <article className="panel profile-card"><div className="panel-head"><div><h2>Alterar senha</h2><p>A senha atual nunca é exibida, pois fica armazenada de forma criptografada.</p></div></div><form onSubmit={savePassword}><PasswordField name="current_password" label="Senha atual" placeholder="Digite sua senha atual" autoComplete="current-password" /><PasswordField name="new_password" label="Nova senha" placeholder="Mínimo de 8 caracteres" autoComplete="new-password" /><PasswordField name="confirmation" label="Confirmar nova senha" placeholder="Repita a nova senha" autoComplete="new-password" />{passwordError && <div className="form-error">{passwordError}</div>}<button className="primary-button">Alterar senha</button></form></article>
    </div>
  </>;
}

function PasswordField({ name, label, placeholder, autoComplete }: { name: string; label: string; placeholder: string; autoComplete: string }) {
  const [visible, setVisible] = useState(false);
  return <label>{label}<div className="password-field"><input name={name} type={visible ? "text" : "password"} placeholder={placeholder} autoComplete={autoComplete} required /><button type="button" onClick={() => setVisible(!visible)}>{visible ? "Ocultar" : "Mostrar"}</button></div></label>;
}

function CreateGroup({ onCreated }: { onCreated: (group: { id: number; name: string; role: string; members: { id: number; name: string; username: string; role: string }[]; categories: Record<string, boolean> }) => void }) {
  const [error, setError] = useState("");
  return <div className="empty-state"><h2>Criar novo grupo</h2><p>Você pode ter quantos grupos quiser: Casa, Viagem, Filhos ou qualquer outro projeto.</p><form onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const response = await fetch("/api/groups", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name") }) }); if (!response.ok) { setError((await response.json()).detail); return; } onCreated(await response.json()); }}><input name="name" required placeholder="Ex.: Casa" />{error && <div className="form-error">{error}</div>}<button className="primary-button">Criar grupo</button></form></div>;
}

function GroupNameEditor({ value, onSave, onCancel }: { value: string; onSave: (value: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(value);
  return <div className="group-name-editor"><input value={name} onChange={(event) => setName(event.target.value)} /><button className="primary-button" onClick={() => onSave(name)}>Salvar</button><button className="secondary-button" onClick={onCancel}>Cancelar</button></div>;
}

function PageHeading({ eyebrow, title, action, onAction }: { eyebrow: string; title: string; action: string; onAction?: () => void }) {
  return <div className="page-title"><div><p>{eyebrow}</p><h1>{title}</h1></div><button className="primary-button" onClick={onAction}>{action.startsWith("Novo") || action.startsWith("Adicionar") || action.startsWith("Convidar") ? "＋ " : "↓ "}{action}</button></div>;
}

function TransactionModal({ transaction, groups, families, accounts, cards, onClose, onSubmit }: { transaction: Transaction | null; groups: Group[]; families: Family[]; accounts: Account[]; cards: Card[]; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const [groupId, setGroupId] = useState(transaction?.group_id ? String(transaction.group_id) : "");
  const [recurring, setRecurring] = useState(false);
  const selectedGroup = groups.find((group) => String(group.id) === groupId);
  const isIncome = (transaction?.value ?? -1) > 0;
  const today = new Date().toISOString().slice(0, 10);
  const financialOptions = [
    ...accounts.map((account) => `${account.bank} · ${account.account_type}`),
    ...cards.map((card) => `${card.bank} · Cartão final ${card.ending}`),
    "Dinheiro",
  ];
  const legacyAccount = transaction?.account && !financialOptions.includes(transaction.account) ? transaction.account : null;
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={(e) => e.stopPropagation()}><div className="modal-head"><div><span>{transaction ? "Editar registro" : "Novo registro"}</span><h2>{transaction ? "Editar lançamento" : "Adicionar lançamento"}</h2></div><button onClick={onClose}>×</button></div><form onSubmit={onSubmit}><div className="form-grid">
    <label className="wide">Descrição<input name="description" required placeholder="Ex.: Supermercado" defaultValue={transaction?.description} /></label>
    <label>Valor<input name="value" required inputMode="decimal" placeholder="0,00" defaultValue={transaction ? Math.abs(transaction.value).toFixed(2).replace(".", ",") : ""} /></label>
    <label>Tipo<select name="type" defaultValue={isIncome ? "Receita" : "Despesa"}><option>Despesa</option><option>Receita</option></select></label>
    <label>Data<input name="date" type="date" required defaultValue={transaction ? brToIso(transaction.date) : today} /></label>
    <label>Status<select name="status" defaultValue={transaction?.status ?? (isIncome ? "Recebido" : "Pago")}><option>Pago</option><option>Recebido</option><option>Pendente</option></select></label>
    <label>Categoria<input name="category" list="category-options" required defaultValue={transaction?.category ?? "Alimentação"} placeholder="Digite ou escolha" /><datalist id="category-options"><option value="Alimentação" /><option value="Moradia" /><option value="Transporte" /><option value="Lazer" /><option value="Saúde" /><option value="Compras pessoais" /><option value="Receita" /></datalist></label>
    <label>Conta ou cartão<select name="account" required defaultValue={transaction?.account ?? financialOptions[0]}>{accounts.length > 0 && <optgroup label="Minhas contas">{accounts.map((account) => <option key={`account-${account.id}`} value={`${account.bank} · ${account.account_type}`}>{account.bank} · {account.account_type}</option>)}</optgroup>}{cards.length > 0 && <optgroup label="Meus cartões">{cards.map((card) => <option key={`card-${card.id}`} value={`${card.bank} · Cartão final ${card.ending}`}>{card.bank} · final {card.ending}</option>)}</optgroup>}<option value="Dinheiro">Dinheiro</option>{legacyAccount && <option value={legacyAccount}>{legacyAccount} (registro antigo)</option>}</select></label>
    <label className="wide">Onde este lançamento aparece?<select name="group_id" value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">Somente no meu espaço pessoal</option>{groups.map((group) => <option key={group.id} value={group.id}>Grupo: {group.name}</option>)}</select></label>
  </div>
  {selectedGroup && <div className="split-box"><strong>Quem participa deste valor?</strong><small>A despesa será dividida igualmente entre as pessoas marcadas.</small><div>{selectedGroup.members.map((member) => <label key={member.id}><input type="checkbox" name="split_user_ids" value={member.id} defaultChecked />{member.name}</label>)}</div></div>}
  <FamilyShareFields families={families} selectedIds={transaction?.family_ids ?? []} />
  {!transaction && <><label className="share-check"><input type="checkbox" name="recurring" checked={recurring} onChange={(event) => setRecurring(event.target.checked)} /><span><strong>Repetir automaticamente todo mês</strong><small>Funciona para pagamentos e recebimentos fixos.</small></span></label>{recurring && <div className="recurring-fields"><label>Dia do mês<input name="recurring_day" type="number" min="1" max="31" defaultValue={new Date(today).getDate()} /></label><label>Repetir até (opcional)<input name="recurring_end" type="date" /></label></div>}</>}
  {transaction?.recurring && <p className="helper">Esta ocorrência veio de uma regra fixa. A edição vale somente para este mês; a regra pode ser pausada ou excluída na tela de lançamentos.</p>}
  <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button">Salvar lançamento</button></div></form></div></div>;
}

function InviteModal({ group, onClose, onSent }: { group: Group; onClose: () => void; onSent: (name: string) => void }) {
  const [error, setError] = useState("");
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal small" onMouseDown={(e) => e.stopPropagation()}><div className="modal-head"><div><span>Novo participante</span><h2>Convidar para {group.name}</h2></div><button onClick={onClose}>×</button></div><form onSubmit={async (e) => { e.preventDefault(); const form = new FormData(e.currentTarget); const response = await fetch(`/api/groups/${group.id}/invitations`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: form.get("username") }) }); if (!response.ok) { setError((await response.json()).detail ?? "Não foi possível convidar"); return; } const invited = await response.json(); onSent(invited.name); }}><label>Usuário da pessoa<input name="username" required placeholder="Ex.: marina" /></label><p className="helper">A pessoa precisará aceitar o convite. Isso não libera as finanças pessoais dela.</p>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button">Enviar convite</button></div></form></div></div>;
}

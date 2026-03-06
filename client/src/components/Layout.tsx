import { useState, useEffect } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import {
  Home,
  BookOpen,
  Brain,
  Layers,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
} from "lucide-react";
import { getDecks } from "../api";
import type { Deck } from "../types";

export default function Layout() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    loadDecks();
  }, []);

  async function loadDecks() {
    try {
      const data = await getDecks();
      setDecks(data);
    } catch {
      // silently fail — decks shown when available
    }
  }

  // Listen for a custom event to refresh decks (fired after create/delete)
  useEffect(() => {
    function handler() {
      loadDecks();
    }
    window.addEventListener("medicard:decks-changed", handler);
    return () => window.removeEventListener("medicard:decks-changed", handler);
  }, []);

  const dueTotal = decks.reduce((sum, d) => sum + (d.dueCount ?? 0), 0);
  const topDueDeck = decks.reduce<Deck | null>((best, d) => {
    if ((d.dueCount ?? 0) > (best?.dueCount ?? 0)) return d;
    return best;
  }, null);

  function handleStudyClick() {
    if (topDueDeck) {
      navigate(`/deck/${topDueDeck.id}/study`);
    }
  }

  const sidebarContent = (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center flex-shrink-0">
          <Brain size={20} className="text-white" />
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            <h1 className="text-lg font-bold text-white tracking-tight">
              MediCard
            </h1>
            <p className="text-xs text-brand-300 truncate">
              Medizinische Lernkarten
            </p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-default ${
              isActive
                ? "bg-white/10 text-white"
                : "text-brand-200 hover:bg-white/5 hover:text-white"
            }`
          }
          onClick={() => setMobileOpen(false)}
        >
          <Home size={18} />
          {!collapsed && <span>Dashboard</span>}
        </NavLink>

        {!collapsed && (
          <div className="pt-4 pb-2 px-3">
            <p className="text-xs font-semibold text-brand-400 uppercase tracking-wider">
              Decks
            </p>
          </div>
        )}

        {decks.map((deck) => (
          <NavLink
            key={deck.id}
            to={`/deck/${deck.id}`}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-default ${
                isActive
                  ? "bg-white/10 text-white"
                  : "text-brand-200 hover:bg-white/5 hover:text-white"
              }`
            }
            onClick={() => setMobileOpen(false)}
          >
            <div
              className="w-5 h-5 rounded-md flex-shrink-0"
              style={{ backgroundColor: deck.color || "#6366f1" }}
            />
            {!collapsed && (
              <span className="truncate flex-1">{deck.name}</span>
            )}
            {!collapsed && (deck.dueCount ?? 0) > 0 && (
              <span className="text-xs bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full">
                {deck.dueCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Collapse toggle (desktop only) */}
      <div className="hidden lg:block px-3 py-3 border-t border-white/10">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-brand-300 hover:text-white hover:bg-white/5 transition-default w-full"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          {!collapsed && <span>Einklappen</span>}
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:flex flex-col bg-brand-950 border-r border-brand-900 transition-all duration-300 ${
          collapsed ? "w-[72px]" : "w-64"
        }`}
        style={{ minHeight: "100vh", position: "sticky", top: 0 }}
      >
        {sidebarContent}
      </aside>

      {/* Mobile sidebar backdrop */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar drawer */}
      <aside
        className={`lg:hidden fixed inset-y-0 left-0 z-50 w-72 bg-brand-950 flex flex-col transform transition-transform duration-300 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <button
          onClick={() => setMobileOpen(false)}
          className="absolute top-4 right-4 text-brand-300 hover:text-white"
        >
          <X size={20} />
        </button>
        {sidebarContent}
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Mobile top bar */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 -ml-2 text-gray-600 hover:text-gray-900"
          >
            <Menu size={22} />
          </button>
          <div className="flex items-center gap-2">
            <Brain size={20} className="text-brand-600" />
            <span className="font-bold text-gray-900">MediCard</span>
          </div>
          <div className="w-10" />
        </header>

        <main className="flex-1 p-4 md:p-6 lg:p-8 pb-24 lg:pb-8">
          <Outlet />
        </main>

        {/* Mobile bottom navigation */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 px-2 py-1 z-30">
          <div className="flex items-center justify-around">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 px-4 py-2 text-xs font-medium transition-default ${
                  isActive ? "text-brand-600" : "text-gray-500"
                }`
              }
            >
              <Home size={20} />
              <span>Home</span>
            </NavLink>

            <button
              onClick={handleStudyClick}
              disabled={!topDueDeck}
              className="flex flex-col items-center gap-1 px-4 py-2 text-xs font-medium transition-default text-gray-500 hover:text-brand-600 disabled:opacity-40"
            >
              <div className="relative">
                <BookOpen size={20} />
                {dueTotal > 0 && (
                  <span className="absolute -top-1 -right-2 bg-amber-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                    {dueTotal > 99 ? "99" : dueTotal}
                  </span>
                )}
              </div>
              <span>Lernen</span>
            </button>

            <NavLink
              to="/"
              className="flex flex-col items-center gap-1 px-4 py-2 text-xs font-medium text-gray-500 hover:text-brand-600 transition-default"
            >
              <Layers size={20} />
              <span>Decks</span>
            </NavLink>
          </div>
        </nav>
      </div>
    </div>
  );
}

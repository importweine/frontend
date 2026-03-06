import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Layers,
  CreditCard,
  Clock,
  Trophy,
  Plus,
  BookOpen,
  Brain,
  Sparkles,
} from "lucide-react";
import { getDecks, createDeck } from "../api";
import type { Deck } from "../types";
import CreateDeckModal from "../components/CreateDeckModal";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Guten Morgen";
  if (hour < 18) return "Guten Tag";
  return "Guten Abend";
}

export default function Dashboard() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    loadDecks();
  }, []);

  async function loadDecks() {
    try {
      const data = await getDecks();
      setDecks(data);
    } catch {
      // fail silently
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateDeck(data: {
    name: string;
    description: string;
    color: string;
  }) {
    try {
      await createDeck(data);
      setModalOpen(false);
      await loadDecks();
      window.dispatchEvent(new Event("medicard:decks-changed"));
    } catch (err) {
      alert(
        err instanceof Error ? err.message : "Fehler beim Erstellen des Decks"
      );
    }
  }

  const totalCards = decks.reduce(
    (s, d) => s + (d.cardCount ?? 0),
    0
  );
  const dueToday = decks.reduce((s, d) => s + (d.dueCount ?? 0), 0);
  const mastered = decks.reduce((s, d) => s + (d.masteredCount ?? 0), 0);

  const stats = [
    {
      label: "Decks",
      value: decks.length,
      icon: Layers,
      color: "text-brand-600",
      bg: "bg-brand-50",
    },
    {
      label: "Karten gesamt",
      value: totalCards,
      icon: CreditCard,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      label: "Heute fällig",
      value: dueToday,
      icon: Clock,
      color: "text-amber-600",
      bg: "bg-amber-50",
    },
    {
      label: "Gemeistert",
      value: mastered,
      icon: Trophy,
      color: "text-green-600",
      bg: "bg-green-50",
    },
  ];

  if (loading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-8 bg-gray-200 rounded-lg w-64" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-gray-200 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 bg-gray-200 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Welcome header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
            {getGreeting()} <span className="inline-block">👋</span>
          </h1>
          <p className="text-gray-500 mt-1">
            Bereit zum Lernen? Hier ist dein aktueller Fortschritt.
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 text-white text-sm font-medium rounded-xl hover:bg-brand-700 transition-default shadow-sm"
        >
          <Plus size={18} />
          Neues Deck
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-xl p-4 md:p-5 shadow-sm border border-gray-100"
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-xl ${stat.bg} flex items-center justify-center`}
              >
                <stat.icon size={20} className={stat.color} />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  {stat.value}
                </p>
                <p className="text-xs text-gray-500">{stat.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Decks grid */}
      {decks.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <div className="w-20 h-20 rounded-2xl bg-brand-50 flex items-center justify-center mx-auto mb-6">
            <Brain size={40} className="text-brand-400" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            Erstelle dein erstes Deck
          </h2>
          <p className="text-gray-500 max-w-md mx-auto mb-6">
            Organisiere deine Lernkarten in Decks. Zum Beispiel nach Fach,
            Thema oder Prüfung.
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 px-6 py-3 bg-brand-600 text-white font-medium rounded-xl hover:bg-brand-700 transition-default"
          >
            <Plus size={18} />
            Erstes Deck erstellen
          </button>
        </div>
      ) : (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Deine Decks
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {decks.map((deck) => {
              const cardCount = deck.cardCount ?? 0;
              const due = deck.dueCount ?? 0;
              const masteredCount = deck.masteredCount ?? 0;
              const progress =
                cardCount > 0
                  ? Math.round((masteredCount / cardCount) * 100)
                  : 0;

              return (
                <div
                  key={deck.id}
                  className="group bg-white rounded-xl shadow-sm border border-gray-100 hover:shadow-md hover:border-gray-200 transition-default cursor-pointer overflow-hidden"
                  onClick={() => navigate(`/deck/${deck.id}`)}
                >
                  {/* Color accent bar */}
                  <div
                    className="h-1.5"
                    style={{
                      backgroundColor: deck.color || "#6366f1",
                    }}
                  />

                  <div className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-base font-semibold text-gray-900 truncate group-hover:text-brand-600 transition-default">
                          {deck.name}
                        </h3>
                        {deck.description && (
                          <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                            {deck.description}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Stats row */}
                    <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
                      <span className="flex items-center gap-1">
                        <CreditCard size={14} />
                        {cardCount} Karten
                      </span>
                      {due > 0 && (
                        <span className="flex items-center gap-1 text-amber-600 font-medium">
                          <Clock size={14} />
                          {due} fällig
                        </span>
                      )}
                      {masteredCount > 0 && (
                        <span className="flex items-center gap-1 text-green-600">
                          <Sparkles size={14} />
                          {masteredCount} gemeistert
                        </span>
                      )}
                    </div>

                    {/* Progress bar */}
                    {cardCount > 0 && (
                      <div className="mb-4">
                        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                          <span>Fortschritt</span>
                          <span>{progress}%</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${progress}%`,
                              backgroundColor: deck.color || "#6366f1",
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Action button */}
                    {due > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/deck/${deck.id}/study`);
                        }}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-brand-50 text-brand-700 text-sm font-medium rounded-lg hover:bg-brand-100 transition-default"
                      >
                        <BookOpen size={16} />
                        Lernen ({due})
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Add deck card */}
            <button
              onClick={() => setModalOpen(true)}
              className="flex flex-col items-center justify-center gap-3 p-8 bg-white rounded-xl border-2 border-dashed border-gray-200 text-gray-400 hover:border-brand-300 hover:text-brand-600 hover:bg-brand-50/30 transition-default min-h-[200px]"
            >
              <Plus size={28} />
              <span className="text-sm font-medium">Neues Deck</span>
            </button>
          </div>
        </div>
      )}

      <CreateDeckModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={handleCreateDeck}
      />
    </div>
  );
}

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  Plus,
  Search,
  Trash2,
  Edit3,
  Upload,
  FileText,
  Image,
  Check,
  Clock,
  AlertCircle,
  Loader2,
  MoreVertical,
  X,
  Sparkles,
} from "lucide-react";
import {
  getDeck,
  getCards,
  deleteCard,
  getDeckStats,
  getUploads,
  uploadFile,
  deleteDeck,
  updateDeck,
} from "../api";
import type { Deck, Card, Upload as UploadType, DeckStats } from "../types";
import ConfirmDialog from "../components/ConfirmDialog";

type Tab = "cards" | "upload";

export default function DeckView() {
  const { id: deckId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [deck, setDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [stats, setStats] = useState<DeckStats | null>(null);
  const [uploads, setUploads] = useState<UploadType[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("cards");
  const [search, setSearch] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: "card" | "deck";
    id?: string;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    try {
      const [deckData, cardsData, statsData, uploadsData] = await Promise.all([
        getDeck(deckId!),
        getCards({ deckId }),
        getDeckStats(deckId!),
        getUploads(deckId!),
      ]);
      setDeck(deckData);
      setCards(cardsData);
      setStats(statsData);
      setUploads(uploadsData);
      setNameValue(deckData.name);
    } catch {
      navigate("/");
    } finally {
      setLoading(false);
    }
  }, [deckId, navigate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [editingName]);

  async function handleNameSave() {
    if (!nameValue.trim() || !deck) return;
    setEditingName(false);
    if (nameValue.trim() !== deck.name) {
      try {
        const updated = await updateDeck(deckId!, { name: nameValue.trim() });
        setDeck(updated);
        window.dispatchEvent(new Event("medicard:decks-changed"));
      } catch {
        setNameValue(deck.name);
      }
    }
  }

  async function handleDeleteCard() {
    if (!deleteConfirm || deleteConfirm.type !== "card" || !deleteConfirm.id)
      return;
    try {
      await deleteCard(deleteConfirm.id);
      setCards((prev) => prev.filter((c) => c.id !== deleteConfirm.id));
      setStats((prev) =>
        prev ? { ...prev, totalCards: prev.totalCards - 1 } : prev
      );
      setDeleteConfirm(null);
      window.dispatchEvent(new Event("medicard:decks-changed"));
    } catch (err) {
      alert(
        err instanceof Error ? err.message : "Fehler beim Löschen der Karte"
      );
    }
  }

  async function handleDeleteDeck() {
    try {
      await deleteDeck(deckId!);
      window.dispatchEvent(new Event("medicard:decks-changed"));
      navigate("/");
    } catch (err) {
      alert(
        err instanceof Error ? err.message : "Fehler beim Löschen des Decks"
      );
    }
  }

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        await uploadFile(deckId!, file);
      }
      const uploadsData = await getUploads(deckId!);
      setUploads(uploadsData);
      // Refresh cards after a delay to allow processing
      setTimeout(async () => {
        const [cardsData, statsData] = await Promise.all([
          getCards({ deckId }),
          getDeckStats(deckId!),
        ]);
        setCards(cardsData);
        setStats(statsData);
        window.dispatchEvent(new Event("medicard:decks-changed"));
      }, 2000);
    } catch (err) {
      alert(
        err instanceof Error ? err.message : "Fehler beim Hochladen"
      );
    } finally {
      setUploading(false);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  }

  const filteredCards = cards.filter((card) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      card.front.toLowerCase().includes(q) ||
      card.back.toLowerCase().includes(q)
    );
  });

  function getStatusBadge(status: UploadType["status"]) {
    switch (status) {
      case "PENDING":
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
            <Clock size={12} /> Wartend
          </span>
        );
      case "PROCESSING":
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
            <Loader2 size={12} className="animate-spin" /> Verarbeitung
          </span>
        );
      case "COMPLETED":
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-600">
            <Check size={12} /> Abgeschlossen
          </span>
        );
      case "FAILED":
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-600">
            <AlertCircle size={12} /> Fehlgeschlagen
          </span>
        );
    }
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-6 max-w-5xl mx-auto">
        <div className="h-8 bg-gray-200 rounded-lg w-48" />
        <div className="h-4 bg-gray-200 rounded w-80" />
        <div className="h-12 bg-gray-200 rounded-xl" />
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 bg-gray-200 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!deck) return null;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <button
            onClick={() => navigate("/")}
            className="mt-1 p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-default"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <div
                className="w-4 h-4 rounded-md flex-shrink-0 mt-1.5"
                style={{ backgroundColor: deck.color || "#6366f1" }}
              />
              {editingName ? (
                <input
                  ref={nameInputRef}
                  type="text"
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  onBlur={handleNameSave}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleNameSave();
                    if (e.key === "Escape") {
                      setNameValue(deck.name);
                      setEditingName(false);
                    }
                  }}
                  className="text-2xl font-bold text-gray-900 border-b-2 border-brand-500 outline-none bg-transparent px-0"
                />
              ) : (
                <h1
                  className="text-2xl font-bold text-gray-900 cursor-pointer hover:text-brand-600 transition-default"
                  onClick={() => setEditingName(true)}
                  title="Klicken zum Bearbeiten"
                >
                  {deck.name}
                </h1>
              )}
            </div>
            {deck.description && (
              <p className="text-gray-500 mt-1 ml-7">{deck.description}</p>
            )}
            {stats && (
              <div className="flex items-center gap-4 text-sm text-gray-500 mt-2 ml-7">
                <span>{stats.totalCards} Karten</span>
                {stats.dueCards > 0 && (
                  <span className="text-amber-600 font-medium">
                    {stats.dueCards} fällig
                  </span>
                )}
                <span className="text-green-600">
                  {stats.masteredCards} gemeistert
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Overflow menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-default"
          >
            <MoreVertical size={20} />
          </button>
          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 top-full mt-1 z-20 bg-white rounded-xl shadow-lg border border-gray-100 py-1 w-48">
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setEditingName(true);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <Edit3 size={14} /> Umbenennen
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setDeleteConfirm({ type: "deck" });
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                >
                  <Trash2 size={14} /> Deck löschen
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setTab("cards")}
          className={`px-5 py-3 text-sm font-medium border-b-2 transition-default ${
            tab === "cards"
              ? "border-brand-600 text-brand-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Karten ({cards.length})
        </button>
        <button
          onClick={() => setTab("upload")}
          className={`px-5 py-3 text-sm font-medium border-b-2 transition-default ${
            tab === "upload"
              ? "border-brand-600 text-brand-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          <span className="flex items-center gap-2">
            <Upload size={16} />
            Hochladen
          </span>
        </button>
      </div>

      {/* Cards Tab */}
      {tab === "cards" && (
        <div className="space-y-4">
          {/* Search and actions bar */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search
                size={18}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                placeholder="Karten durchsuchen..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none transition-default"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <button
              onClick={() => navigate(`/deck/${deckId}/cards/new`)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-brand-600 text-white text-sm font-medium rounded-xl hover:bg-brand-700 transition-default whitespace-nowrap"
            >
              <Plus size={16} />
              Neue Karte
            </button>
          </div>

          {/* Cards list */}
          {filteredCards.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
              {cards.length === 0 ? (
                <>
                  <div className="w-16 h-16 rounded-xl bg-gray-50 flex items-center justify-center mx-auto mb-4">
                    <FileText size={28} className="text-gray-300" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">
                    Noch keine Karten
                  </h3>
                  <p className="text-sm text-gray-500 mb-4">
                    Erstelle deine erste Karte oder lade ein Dokument hoch.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <button
                      onClick={() => navigate(`/deck/${deckId}/cards/new`)}
                      className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 text-white text-sm font-medium rounded-xl hover:bg-brand-700 transition-default"
                    >
                      <Plus size={16} />
                      Karte erstellen
                    </button>
                    <button
                      onClick={() => setTab("upload")}
                      className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-200 transition-default"
                    >
                      <Upload size={16} />
                      Dokument hochladen
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <Search size={28} className="text-gray-300 mx-auto mb-3" />
                  <p className="text-sm text-gray-500">
                    Keine Karten gefunden für &quot;{search}&quot;
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredCards.map((card) => {
                const isDue =
                  new Date(card.nextReview) <= new Date();
                const isMastered = card.interval >= 21;
                return (
                  <div
                    key={card.id}
                    className="group bg-white rounded-xl border border-gray-100 hover:border-gray-200 hover:shadow-sm transition-default p-4 cursor-pointer"
                    onClick={() =>
                      navigate(`/deck/${deckId}/cards/${card.id}/edit`)
                    }
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 line-clamp-2">
                          {card.front}
                        </p>
                        <p className="text-xs text-gray-500 mt-1 line-clamp-1">
                          {card.back}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {/* Source badge */}
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${
                            card.source === "ai"
                              ? "bg-purple-50 text-purple-600"
                              : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {card.source === "AI_GENERATED" ? "KI" : "Manuell"}
                        </span>
                        {/* Review status */}
                        {isMastered ? (
                          <Sparkles size={16} className="text-green-500" />
                        ) : isDue ? (
                          <Clock size={16} className="text-amber-500" />
                        ) : null}
                        {/* Delete */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirm({ type: "card", id: card.id });
                          }}
                          className="p-1.5 text-gray-300 hover:text-red-500 rounded-lg hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-default"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Upload Tab */}
      {tab === "upload" && (
        <div className="space-y-6">
          {/* Drop zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`relative border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-default ${
              dragOver
                ? "border-brand-500 bg-brand-50"
                : "border-gray-200 bg-white hover:border-brand-300 hover:bg-brand-50/30"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              multiple
              onChange={(e) => handleUpload(e.target.files)}
              className="hidden"
            />
            {uploading ? (
              <div className="flex flex-col items-center gap-3">
                <Loader2
                  size={40}
                  className="text-brand-500 animate-spin"
                />
                <p className="text-sm font-medium text-gray-700">
                  Wird hochgeladen...
                </p>
              </div>
            ) : (
              <>
                <div className="w-16 h-16 rounded-2xl bg-brand-50 flex items-center justify-center mx-auto mb-4">
                  <Upload size={28} className="text-brand-500" />
                </div>
                <p className="text-base font-semibold text-gray-900 mb-1">
                  Dateien hier ablegen
                </p>
                <p className="text-sm text-gray-500 mb-3">
                  oder klicken zum Auswählen
                </p>
                <div className="flex items-center justify-center gap-4 text-xs text-gray-400">
                  <span className="flex items-center gap-1">
                    <FileText size={14} /> PDF
                  </span>
                  <span className="flex items-center gap-1">
                    <Image size={14} /> PNG, JPG, WebP
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Upload history */}
          {uploads.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">
                Upload-Verlauf
              </h3>
              <div className="space-y-2">
                {uploads.map((upload) => (
                  <div
                    key={upload.id}
                    className="bg-white rounded-xl border border-gray-100 p-4 flex items-center gap-4"
                  >
                    <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center flex-shrink-0">
                      {upload.mimeType.includes("pdf") ? (
                        <FileText size={20} className="text-red-500" />
                      ) : (
                        <Image size={20} className="text-blue-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {upload.originalName}
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(upload.createdAt).toLocaleDateString("de-DE", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {upload.cardCount > 0 && (
                        <span className="text-xs text-gray-500">
                          {upload.cardCount} Karten
                        </span>
                      )}
                      {getStatusBadge(upload.status)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Floating study button */}
      {stats && stats.dueCards > 0 && (
        <button
          onClick={() => navigate(`/deck/${deckId}/study`)}
          className="fixed bottom-20 lg:bottom-8 right-6 inline-flex items-center gap-2 px-6 py-3 bg-brand-600 text-white font-medium rounded-full shadow-lg shadow-brand-600/30 hover:bg-brand-700 hover:shadow-xl transition-default z-20"
        >
          <BookOpen size={20} />
          Lernen starten ({stats.dueCards})
        </button>
      )}

      {/* Confirm dialogs */}
      <ConfirmDialog
        open={deleteConfirm?.type === "card"}
        title="Karte löschen"
        message="Möchtest du diese Karte wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden."
        confirmLabel="Löschen"
        destructive
        onConfirm={handleDeleteCard}
        onCancel={() => setDeleteConfirm(null)}
      />
      <ConfirmDialog
        open={deleteConfirm?.type === "deck"}
        title="Deck löschen"
        message={`Möchtest du "${deck.name}" wirklich löschen? Alle Karten in diesem Deck werden ebenfalls gelöscht.`}
        confirmLabel="Deck löschen"
        destructive
        onConfirm={handleDeleteDeck}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );
}

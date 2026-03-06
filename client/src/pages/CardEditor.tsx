import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Save,
  Eye,
  Image,
  Upload,
  X,
  Brain,
} from "lucide-react";
import { getDeck, getCards, createCard, updateCard } from "../api";
import type { Deck, Card } from "../types";

export default function CardEditor() {
  const { id: deckId, cardId } = useParams<{ id: string; cardId: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(cardId);

  const [deck, setDeck] = useState<Deck | null>(null);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewFlipped, setPreviewFlipped] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const deckData = await getDeck(deckId);
        setDeck(deckData);

        if (isEdit && cardId) {
          const cards = await getCards({ deckId });
          const card = cards.find((c: Card) => c.id === Number(cardId));
          if (card) {
            setFront(card.front);
            setBack(card.back);
            setImageUrl(card.imageUrl);
            setImagePreview(card.imageUrl);
          } else {
            navigate(`/deck/${deckId}`);
          }
        }
      } catch {
        navigate("/");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [deckId, cardId, isEdit, navigate]);

  async function handleSave() {
    if (!front.trim() || !back.trim()) return;
    setSaving(true);
    try {
      if (isEdit && cardId) {
        await updateCard(Number(cardId), {
          front: front.trim(),
          back: back.trim(),
          imageUrl: imageUrl,
        });
      } else {
        await createCard({
          deckId,
          front: front.trim(),
          back: back.trim(),
          imageUrl: imageUrl ?? undefined,
        });
      }
      window.dispatchEvent(new Event("medicard:decks-changed"));
      navigate(`/deck/${deckId}`);
    } catch (err) {
      alert(
        err instanceof Error ? err.message : "Fehler beim Speichern"
      );
    } finally {
      setSaving(false);
    }
  }

  function handleImageFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setImagePreview(dataUrl);
      setImageUrl(dataUrl);
    };
    reader.readAsDataURL(file);
  }

  function handleImageDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleImageFile(file);
  }

  function removeImage() {
    setImageUrl(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-6 max-w-3xl mx-auto">
        <div className="h-8 bg-gray-200 rounded-lg w-48" />
        <div className="h-40 bg-gray-200 rounded-xl" />
        <div className="h-40 bg-gray-200 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/deck/${deckId}`)}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-default"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              {isEdit ? "Karte bearbeiten" : "Neue Karte"}
            </h1>
            {deck && (
              <p className="text-sm text-gray-500">in {deck.name}</p>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowPreview(!showPreview)}
          className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl transition-default ${
            showPreview
              ? "bg-brand-50 text-brand-700"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          <Eye size={16} />
          Vorschau
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Editor */}
        <div className="space-y-5">
          {/* Front */}
          <div>
            <label
              htmlFor="card-front"
              className="block text-sm font-medium text-gray-700 mb-1.5"
            >
              Vorderseite (Frage) *
            </label>
            <textarea
              id="card-front"
              value={front}
              onChange={(e) => setFront(e.target.value)}
              placeholder="z.B. Was ist die Funktion des Musculus deltoideus?"
              rows={5}
              className="w-full px-4 py-3 text-base border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none resize-none transition-default"
              autoFocus
            />
          </div>

          {/* Back */}
          <div>
            <label
              htmlFor="card-back"
              className="block text-sm font-medium text-gray-700 mb-1.5"
            >
              Rückseite (Antwort) *
            </label>
            <textarea
              id="card-back"
              value={back}
              onChange={(e) => setBack(e.target.value)}
              placeholder="z.B. Abduktion des Arms im Schultergelenk (ab 15°), Flexion und Innenrotation (pars clavicularis), Extension und Außenrotation (pars spinalis)"
              rows={6}
              className="w-full px-4 py-3 text-base border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none resize-none transition-default"
            />
          </div>

          {/* Image upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Bild (optional)
            </label>
            {imagePreview ? (
              <div className="relative bg-gray-50 rounded-xl p-4">
                <img
                  src={imagePreview}
                  alt="Vorschau"
                  className="max-h-48 mx-auto rounded-lg object-contain"
                />
                <button
                  onClick={removeImage}
                  className="absolute top-2 right-2 p-1.5 bg-white rounded-full shadow-sm text-gray-400 hover:text-red-500 transition-default"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                }}
                onDrop={handleImageDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-default ${
                  dragOver
                    ? "border-brand-500 bg-brand-50"
                    : "border-gray-200 hover:border-brand-300 hover:bg-gray-50"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImageFile(file);
                  }}
                  className="hidden"
                />
                <div className="flex flex-col items-center gap-2">
                  <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                    <Image size={20} className="text-gray-400" />
                  </div>
                  <p className="text-sm text-gray-500">
                    Bild hierher ziehen oder{" "}
                    <span className="text-brand-600 font-medium">
                      durchsuchen
                    </span>
                  </p>
                  <p className="text-xs text-gray-400">
                    PNG, JPG, WebP
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => navigate(`/deck/${deckId}`)}
              className="px-5 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-default"
            >
              Abbrechen
            </button>
            <button
              onClick={handleSave}
              disabled={!front.trim() || !back.trim() || saving}
              className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-brand-600 rounded-xl hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-default"
            >
              {saving ? (
                <>
                  <Upload size={16} className="animate-spin" />
                  Speichern...
                </>
              ) : (
                <>
                  <Save size={16} />
                  {isEdit ? "Speichern" : "Karte erstellen"}
                </>
              )}
            </button>
          </div>
        </div>

        {/* Preview panel */}
        {showPreview && (
          <div className="lg:sticky lg:top-8">
            <p className="text-sm font-medium text-gray-700 mb-3">
              Kartenvorschau
            </p>
            <div
              className="perspective cursor-pointer"
              style={{ height: "360px" }}
              onClick={() => setPreviewFlipped(!previewFlipped)}
            >
              <div
                className={`card-inner ${previewFlipped ? "flipped" : ""}`}
              >
                {/* Front */}
                <div className="card-face bg-white rounded-2xl shadow-lg border border-gray-100 p-8 flex flex-col items-center justify-center">
                  <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center mb-4">
                    <Brain size={22} className="text-brand-500" />
                  </div>
                  <p className="text-lg font-semibold text-gray-900 text-center">
                    {front || (
                      <span className="text-gray-300">
                        Vorderseite...
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-400 mt-6">
                    Tippen zum Aufdecken
                  </p>
                </div>

                {/* Back */}
                <div className="card-face card-face-back bg-white rounded-2xl shadow-lg border border-gray-100 p-8 flex flex-col items-center justify-center overflow-y-auto">
                  <p className="text-base text-gray-800 text-center whitespace-pre-wrap">
                    {back || (
                      <span className="text-gray-300">
                        Rückseite...
                      </span>
                    )}
                  </p>
                  {imagePreview && (
                    <img
                      src={imagePreview}
                      alt="Vorschau"
                      className="mt-4 max-h-32 rounded-lg object-contain"
                    />
                  )}
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-400 text-center mt-2">
              Klicken zum Umdrehen
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

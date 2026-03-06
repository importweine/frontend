import { useState, useEffect } from "react";
import { X, Palette } from "lucide-react";

const COLORS = [
  { name: "Indigo", value: "#6366f1" },
  { name: "Blau", value: "#3b82f6" },
  { name: "Grün", value: "#22c55e" },
  { name: "Bernstein", value: "#f59e0b" },
  { name: "Rose", value: "#f43f5e" },
  { name: "Lila", value: "#a855f7" },
  { name: "Teal", value: "#14b8a6" },
  { name: "Orange", value: "#f97316" },
];

interface CreateDeckModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (data: {
    name: string;
    description: string;
    color: string;
  }) => void;
}

export default function CreateDeckModal({
  open,
  onClose,
  onCreated,
}: CreateDeckModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(COLORS[0].value);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setColor(COLORS[0].value);
    }
  }, [open]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      onCreated({ name: name.trim(), description: description.trim(), color });
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-default"
        >
          <X size={20} />
        </button>

        <h2 className="text-xl font-bold text-gray-900 mb-6">
          Neues Deck erstellen
        </h2>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="deck-name"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Name *
            </label>
            <input
              id="deck-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z.B. Anatomie Obere Extremität"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none transition-default"
              autoFocus
              required
            />
          </div>

          <div>
            <label
              htmlFor="deck-desc"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Beschreibung
            </label>
            <textarea
              id="deck-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Worum geht es in diesem Deck?"
              rows={3}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none resize-none transition-default"
            />
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
              <Palette size={16} />
              Farbe
            </label>
            <div className="flex gap-3 flex-wrap">
              {COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setColor(c.value)}
                  className={`w-10 h-10 rounded-xl transition-default ${
                    color === c.value
                      ? "ring-2 ring-offset-2 ring-gray-400 scale-110"
                      : "hover:scale-105"
                  }`}
                  style={{ backgroundColor: c.value }}
                  title={c.name}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-default"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={!name.trim() || loading}
              className="px-5 py-2.5 text-sm font-medium text-white bg-brand-600 rounded-xl hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-default"
            >
              {loading ? "Erstelle..." : "Deck erstellen"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

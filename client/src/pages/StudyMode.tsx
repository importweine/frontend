import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  X,
  RotateCcw,
  ArrowRight,
  Trophy,
  Brain,
  Keyboard,
} from "lucide-react";
import { getDeck, getCards, reviewCard, getImageSrc, getImageFallbackSrc } from "../api";
import type { Deck, Card } from "../types";

export default function StudyMode() {
  const { id: deckId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [deck, setDeck] = useState<Deck | null>(null);
  const [dueCards, setDueCards] = useState<Card[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [sessionStats, setSessionStats] = useState({
    reviewed: 0,
    again: 0,
    hard: 0,
    good: 0,
    easy: 0,
  });
  const [showKeyboardHint, setShowKeyboardHint] = useState(true);
  const preloadedImages = useRef<Set<string>>(new Set());
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [deckData, cardsData] = await Promise.all([
          getDeck(deckId!),
          getCards({ deckId, due: true }),
        ]);
        setDeck(deckData);
        setDueCards(cardsData);
        if (cardsData.length === 0) {
          setCompleted(true);
        }
      } catch {
        navigate("/");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [deckId, navigate]);

  // Hide keyboard hint after 5 seconds
  useEffect(() => {
    const timer = setTimeout(() => setShowKeyboardHint(false), 5000);
    return () => clearTimeout(timer);
  }, []);

  // Preload images for upcoming cards (next 3)
  useEffect(() => {
    const PRELOAD_AHEAD = 3;
    for (let i = currentIndex; i < Math.min(currentIndex + PRELOAD_AHEAD, dueCards.length); i++) {
      const card = dueCards[i];
      const imgSrc = getImageSrc(card?.imageUrl);
      if (imgSrc && !preloadedImages.current.has(card.id)) {
        const img = new Image();
        img.src = imgSrc;
        preloadedImages.current.add(card.id);
      }
    }
  }, [currentIndex, dueCards]);

  // Poll for images that are still generating (refresh card data)
  useEffect(() => {
    const hasGenerating = dueCards.some(
      (c, i) =>
        i >= currentIndex &&
        !c.imageUrl &&
        (c.imageStatus === "PENDING" || c.imageStatus === "GENERATING")
    );

    if (hasGenerating && !pollingRef.current) {
      pollingRef.current = setInterval(async () => {
        try {
          const freshCards = await getCards({ deckId, due: true });
          setDueCards((prev) => {
            // Merge: keep review progress but update imageUrl/imageStatus
            return prev.map((oldCard) => {
              const fresh = freshCards.find((c) => c.id === oldCard.id);
              if (fresh && fresh.imageUrl && !oldCard.imageUrl) {
                // Preload newly available image
                const img = new Image();
                img.src = getImageSrc(fresh.imageUrl) || fresh.imageUrl;
                preloadedImages.current.add(fresh.id);
                return { ...oldCard, imageUrl: fresh.imageUrl, imageStatus: fresh.imageStatus };
              }
              if (fresh && fresh.imageStatus !== oldCard.imageStatus) {
                return { ...oldCard, imageStatus: fresh.imageStatus };
              }
              return oldCard;
            });
          });
        } catch {
          // ignore polling errors
        }
      }, 5000);
    }

    // Stop polling when no more generating cards ahead
    if (!hasGenerating && pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [dueCards, currentIndex, deckId]);

  const currentCard = dueCards[currentIndex] ?? null;

  const handleFlip = useCallback(() => {
    if (!flipped && currentCard) {
      setFlipped(true);
    }
  }, [flipped, currentCard]);

  const handleRate = useCallback(
    async (quality: number) => {
      if (!currentCard || reviewing) return;
      setReviewing(true);

      const statKey =
        quality === 1
          ? "again"
          : quality === 2
          ? "hard"
          : quality === 3
          ? "good"
          : "easy";

      try {
        await reviewCard(currentCard.id, quality);
        setSessionStats((prev) => ({
          ...prev,
          reviewed: prev.reviewed + 1,
          [statKey]: prev[statKey] + 1,
        }));

        if (currentIndex + 1 >= dueCards.length) {
          setCompleted(true);
        } else {
          setCurrentIndex((prev) => prev + 1);
          setFlipped(false);
        }
      } catch {
        // allow retry
      } finally {
        setReviewing(false);
      }
    },
    [currentCard, reviewing, currentIndex, dueCards.length]
  );

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === "Space") {
        e.preventDefault();
        if (!flipped) {
          handleFlip();
        }
      } else if (flipped && !reviewing) {
        switch (e.key) {
          case "1":
            handleRate(1);
            break;
          case "2":
            handleRate(2);
            break;
          case "3":
            handleRate(3);
            break;
          case "4":
            handleRate(5);
            break;
        }
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [flipped, reviewing, handleFlip, handleRate]);

  function handleExit() {
    navigate(`/deck/${deckId}`);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-pulse space-y-4 text-center">
          <div className="w-16 h-16 bg-gray-200 rounded-2xl mx-auto" />
          <div className="h-4 bg-gray-200 rounded w-32 mx-auto" />
        </div>
      </div>
    );
  }

  // Completion screen
  if (completed) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-brand-50 via-white to-green-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center mx-auto mb-8 shadow-lg shadow-green-500/30">
            <Trophy size={48} className="text-white" />
          </div>

          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Geschafft!
          </h1>
          <p className="text-gray-500 mb-8">
            {sessionStats.reviewed === 0
              ? "Keine Karten waren heute fällig. Komm später wieder!"
              : `Du hast ${sessionStats.reviewed} Karte${sessionStats.reviewed !== 1 ? "n" : ""} wiederholt.`}
          </p>

          {sessionStats.reviewed > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-8">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">
                Zusammenfassung
              </h3>
              <div className="grid grid-cols-4 gap-3">
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-500">
                    {sessionStats.again}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">Nochmal</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-500">
                    {sessionStats.hard}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">Schwer</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-500">
                    {sessionStats.good}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">Gut</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-500">
                    {sessionStats.easy}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">Einfach</div>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={handleExit}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-brand-600 text-white font-medium rounded-xl hover:bg-brand-700 transition-default"
            >
              Zurück zum Deck
              <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!currentCard) return null;

  const progress =
    dueCards.length > 0
      ? Math.round((currentIndex / dueCards.length) * 100)
      : 0;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 md:px-6 py-3 bg-white border-b border-gray-200">
        <button
          onClick={handleExit}
          className="p-2 -ml-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-default"
        >
          <X size={22} />
        </button>
        <div className="text-center">
          <p className="text-sm font-medium text-gray-900">{deck?.name}</p>
          <p className="text-xs text-gray-500">
            Karte {currentIndex + 1} von {dueCards.length}
          </p>
        </div>
        <div className="w-10" />
      </header>

      {/* Progress bar */}
      <div className="h-1 bg-gray-100">
        <div
          className="h-full bg-brand-500 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Card area */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 md:p-8">
        {/* Keyboard hint */}
        {showKeyboardHint && (
          <div className="hidden md:flex items-center gap-2 text-xs text-gray-400 mb-4 animate-pulse">
            <Keyboard size={14} />
            <span>
              Leertaste zum Aufdecken, 1-4 zum Bewerten
            </span>
          </div>
        )}

        {/* Flashcard */}
        <div
          className="perspective w-full max-w-2xl cursor-pointer"
          style={{ height: "clamp(300px, 50vh, 500px)" }}
          onClick={handleFlip}
        >
          <div className={`card-inner ${flipped ? "flipped" : ""}`}>
            {/* Front */}
            <div className="card-face bg-white rounded-2xl shadow-lg border border-gray-100 p-8 md:p-12 flex flex-col items-center justify-center">
              <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center mb-6">
                <Brain size={22} className="text-brand-500" />
              </div>
              <p className="text-xl md:text-2xl font-semibold text-gray-900 text-center leading-relaxed">
                {currentCard.front}
              </p>
              <p className="text-sm text-gray-400 mt-8">
                Tippen zum Aufdecken
              </p>
            </div>

            {/* Back */}
            <div className="card-face card-face-back bg-white rounded-2xl shadow-lg border border-gray-100 p-8 md:p-12 flex flex-col items-center justify-center overflow-y-auto">
              <p className="text-lg md:text-xl text-gray-800 text-center leading-relaxed whitespace-pre-wrap">
                {currentCard.back}
              </p>
              {currentCard.imageUrl ? (
                <img
                  src={getImageSrc(currentCard.imageUrl) || currentCard.imageUrl}
                  alt="Kartenabbildung"
                  className="mt-6 max-h-48 rounded-xl object-contain"
                  onError={(e) => {
                    const img = e.target as HTMLImageElement;
                    const fallback = getImageFallbackSrc(currentCard.id);
                    if (!img.src.includes("/api/cards/")) {
                      img.src = fallback;
                    } else {
                      img.style.display = 'none';
                    }
                  }}
                />
              ) : (currentCard.imageStatus === "PENDING" || currentCard.imageStatus === "GENERATING") ? (
                <div className="mt-6 w-48 h-32 bg-gray-50 rounded-xl flex items-center justify-center border border-gray-100">
                  <div className="text-center">
                    <div className="w-6 h-6 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin mx-auto mb-2" />
                    <span className="text-xs text-gray-400">Bild wird generiert...</span>
                  </div>
                </div>
              ) : null}
              {currentCard.sourcePages && (
                <p className="mt-4 text-xs text-gray-400">
                  Quelle: Seite {currentCard.sourcePages}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Rating buttons */}
        <div
          className={`mt-8 w-full max-w-2xl transition-all duration-300 ${
            flipped
              ? "opacity-100 translate-y-0"
              : "opacity-0 translate-y-4 pointer-events-none"
          }`}
        >
          <p className="text-center text-sm text-gray-500 mb-4">
            Wie gut konntest du dich erinnern?
          </p>
          <div className="grid grid-cols-4 gap-2 md:gap-3">
            <button
              onClick={() => handleRate(1)}
              disabled={reviewing}
              className="flex flex-col items-center gap-1 px-3 py-3 md:py-4 bg-red-50 text-red-700 rounded-xl hover:bg-red-100 active:bg-red-200 transition-default disabled:opacity-50 border border-red-100"
            >
              <RotateCcw size={20} />
              <span className="text-sm font-medium">Nochmal</span>
              <span className="text-xs text-red-400 hidden md:block">1</span>
            </button>
            <button
              onClick={() => handleRate(2)}
              disabled={reviewing}
              className="flex flex-col items-center gap-1 px-3 py-3 md:py-4 bg-orange-50 text-orange-700 rounded-xl hover:bg-orange-100 active:bg-orange-200 transition-default disabled:opacity-50 border border-orange-100"
            >
              <span className="text-lg">😓</span>
              <span className="text-sm font-medium">Schwer</span>
              <span className="text-xs text-orange-400 hidden md:block">2</span>
            </button>
            <button
              onClick={() => handleRate(3)}
              disabled={reviewing}
              className="flex flex-col items-center gap-1 px-3 py-3 md:py-4 bg-green-50 text-green-700 rounded-xl hover:bg-green-100 active:bg-green-200 transition-default disabled:opacity-50 border border-green-100"
            >
              <span className="text-lg">👍</span>
              <span className="text-sm font-medium">Gut</span>
              <span className="text-xs text-green-400 hidden md:block">3</span>
            </button>
            <button
              onClick={() => handleRate(5)}
              disabled={reviewing}
              className="flex flex-col items-center gap-1 px-3 py-3 md:py-4 bg-blue-50 text-blue-700 rounded-xl hover:bg-blue-100 active:bg-blue-200 transition-default disabled:opacity-50 border border-blue-100"
            >
              <span className="text-lg">🌟</span>
              <span className="text-sm font-medium">Einfach</span>
              <span className="text-xs text-blue-400 hidden md:block">4</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

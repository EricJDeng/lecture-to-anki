"use client";

import { useState, useRef, useCallback } from "react";

interface Flashcard {
  id: string;
  front: string;
  back: string;
}

type AppState = "idle" | "generating" | "done" | "error";

function parseCardsFromBuffer(buffer: string): {
  cards: Flashcard[];
  remaining: string;
} {
  const lines = buffer.split("\n");
  const cards: Flashcard[] = [];
  const unparsedLines: string[] = [];

  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as { front?: string; back?: string };
      if (parsed.front && parsed.back) {
        cards.push({
          id: `card-${Date.now()}-${Math.random()}`,
          front: parsed.front,
          back: parsed.back,
        });
      }
    } catch {
      unparsedLines.push(line);
    }
  }

  // Keep the last (potentially incomplete) line in the buffer
  const remaining = lines[lines.length - 1];
  return { cards, remaining };
}

function exportToAnki(cards: Flashcard[]) {
  const content = cards
    .map((c) => `${c.front.replace(/\t/g, " ")}\t${c.back.replace(/\t/g, " ")}`)
    .join("\n");
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "flashcards.txt";
  a.click();
  URL.revokeObjectURL(url);
}

function CardItem({
  card,
  index,
  onEdit,
  onDelete,
}: {
  card: Flashcard;
  index: number;
  onEdit: (id: string, field: "front" | "back", value: string) => void;
  onDelete: (id: string) => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const [editing, setEditing] = useState(false);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-100">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          Card {index + 1}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setEditing(!editing)}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            {editing ? "Done" : "Edit"}
          </button>
          <button
            onClick={() => onDelete(card.id)}
            className="text-xs text-red-500 hover:text-red-700 font-medium"
          >
            Delete
          </button>
        </div>
      </div>

      {editing ? (
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">
              FRONT
            </label>
            <textarea
              value={card.front}
              onChange={(e) => onEdit(card.id, "front", e.target.value)}
              className="w-full border border-gray-200 rounded-lg p-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={2}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">
              BACK
            </label>
            <textarea
              value={card.back}
              onChange={(e) => onEdit(card.id, "back", e.target.value)}
              className="w-full border border-gray-200 rounded-lg p-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
            />
          </div>
        </div>
      ) : (
        <button
          onClick={() => setFlipped(!flipped)}
          className="w-full text-left p-4 hover:bg-gray-50 transition-colors"
        >
          {!flipped ? (
            <div>
              <p className="text-xs font-semibold text-blue-500 uppercase tracking-wide mb-1">
                Question
              </p>
              <p className="text-gray-800 text-sm leading-relaxed">{card.front}</p>
              <p className="text-xs text-gray-400 mt-2">Click to reveal answer →</p>
            </div>
          ) : (
            <div>
              <p className="text-xs font-semibold text-green-500 uppercase tracking-wide mb-1">
                Answer
              </p>
              <p className="text-gray-700 text-sm leading-relaxed">{card.back}</p>
              <p className="text-xs text-gray-400 mt-2">Click to show question →</p>
            </div>
          )}
        </button>
      )}
    </div>
  );
}

export default function Home() {
  const [lectureText, setLectureText] = useState("");
  const [numCards, setNumCards] = useState(20);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [state, setState] = useState<AppState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === "string") setLectureText(text);
    };
    reader.readAsText(file);
  };

  const handleGenerate = useCallback(async () => {
    if (!lectureText.trim()) return;

    setState("generating");
    setCards([]);
    setErrorMessage("");

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: lectureText, numCards }),
        signal: abort.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        if (buffer.includes("__ERROR__:")) {
          const errorStart = buffer.indexOf("__ERROR__:");
          const errorMsg = buffer.slice(errorStart + 10).trim();
          throw new Error(errorMsg);
        }

        const { cards: newCards, remaining } = parseCardsFromBuffer(buffer);
        if (newCards.length > 0) {
          setCards((prev) => [...prev, ...newCards]);
          buffer = remaining;
        }
      }

      // Parse any remaining content
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim()) as {
            front?: string;
            back?: string;
          };
          if (parsed.front && parsed.back) {
            setCards((prev) => [
              ...prev,
              {
                id: `card-${Date.now()}`,
                front: parsed.front!,
                back: parsed.back!,
              },
            ]);
          }
        } catch {
          // Incomplete line, ignore
        }
      }

      setState("done");
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        setState("idle");
        return;
      }
      setErrorMessage(
        error instanceof Error ? error.message : "Unknown error occurred"
      );
      setState("error");
    }
  }, [lectureText, numCards]);

  const handleStop = () => {
    abortRef.current?.abort();
    setState("done");
  };

  const handleEdit = (id: string, field: "front" | "back", value: string) => {
    setCards((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value } : c))
    );
  };

  const handleDelete = (id: string) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
  };

  const isGenerating = state === "generating";
  const hasCards = cards.length > 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
              <svg
                className="w-5 h-5 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Lecture to Anki</h1>
              <p className="text-xs text-gray-500">AI-powered flashcard generator</p>
            </div>
          </div>
          {hasCards && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">
                {cards.length} card{cards.length !== 1 ? "s" : ""}
              </span>
              <button
                onClick={() => exportToAnki(cards)}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                Export to Anki
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className={`grid gap-8 ${hasCards ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1 max-w-2xl mx-auto"}`}>
          {/* Input Panel */}
          <div className="space-y-5">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
              <h2 className="text-base font-semibold text-gray-800 mb-4">
                Lecture Content
              </h2>

              {/* File upload */}
              <label className="flex items-center gap-2 w-full border-2 border-dashed border-gray-200 rounded-xl p-3 mb-4 cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors group">
                <svg
                  className="w-5 h-5 text-gray-400 group-hover:text-blue-500 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                <span className="text-sm text-gray-500 group-hover:text-blue-600">
                  Upload a text file (.txt, .md)
                </span>
                <input
                  type="file"
                  accept=".txt,.md,.rst,.tex"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </label>

              {/* Text area */}
              <textarea
                value={lectureText}
                onChange={(e) => setLectureText(e.target.value)}
                placeholder="Paste your lecture notes, slides, or any educational content here..."
                className="w-full h-64 border border-gray-200 rounded-xl p-4 text-sm text-gray-700 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={isGenerating}
              />

              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-gray-400">
                  {lectureText.length.toLocaleString()} characters
                </span>
                <button
                  onClick={() => setLectureText("")}
                  className="text-xs text-gray-400 hover:text-gray-600"
                  disabled={isGenerating}
                >
                  Clear
                </button>
              </div>
            </div>

            {/* Options */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
              <h2 className="text-base font-semibold text-gray-800 mb-4">
                Options
              </h2>
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Number of flashcards
                  </label>
                  <p className="text-xs text-gray-400 mt-0.5">
                    AI will generate approximately this many cards
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={5}
                    max={50}
                    step={5}
                    value={numCards}
                    onChange={(e) => setNumCards(Number(e.target.value))}
                    className="w-28 accent-blue-600"
                    disabled={isGenerating}
                  />
                  <span className="text-sm font-semibold text-blue-600 w-8 text-right">
                    {numCards}
                  </span>
                </div>
              </div>
            </div>

            {/* Error */}
            {state === "error" && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-red-700">Error</p>
                <p className="text-sm text-red-600 mt-1">{errorMessage}</p>
              </div>
            )}

            {/* Generate button */}
            <div className="flex gap-3">
              {isGenerating ? (
                <button
                  onClick={handleStop}
                  className="flex-1 flex items-center justify-center gap-2 bg-red-100 hover:bg-red-200 text-red-700 py-3 rounded-xl font-semibold text-sm transition-colors"
                >
                  <div className="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                  Stop generating ({cards.length} cards so far)
                </button>
              ) : (
                <button
                  onClick={handleGenerate}
                  disabled={!lectureText.trim()}
                  className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:cursor-not-allowed text-white disabled:text-gray-400 py-3 rounded-xl font-semibold text-sm transition-colors"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                  Generate Flashcards
                </button>
              )}
            </div>

            {/* Instructions */}
            {!hasCards && !isGenerating && (
              <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                <p className="text-xs font-semibold text-blue-700 mb-2">
                  How to import into Anki
                </p>
                <ol className="text-xs text-blue-600 space-y-1 list-decimal list-inside">
                  <li>Generate and review your flashcards above</li>
                  <li>Click "Export to Anki" to download flashcards.txt</li>
                  <li>Open Anki → File → Import</li>
                  <li>Select the downloaded file</li>
                  <li>Set field separator to "Tab" and import</li>
                </ol>
              </div>
            )}
          </div>

          {/* Cards Panel */}
          {(hasCards || isGenerating) && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-gray-800">
                  Flashcards
                  {isGenerating && (
                    <span className="ml-2 text-sm font-normal text-gray-400">
                      generating...
                    </span>
                  )}
                </h2>
                {hasCards && (
                  <span className="text-sm text-gray-500 bg-white border border-gray-200 px-3 py-1 rounded-full">
                    {cards.length} card{cards.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {isGenerating && cards.length === 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                  <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-sm text-gray-500">
                    Claude is reading your lecture...
                  </p>
                </div>
              )}

              <div className="space-y-3 max-h-[calc(100vh-200px)] overflow-y-auto pr-1">
                {cards.map((card, index) => (
                  <CardItem
                    key={card.id}
                    card={card}
                    index={index}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                  />
                ))}
              </div>

              {state === "done" && hasCards && (
                <button
                  onClick={() => exportToAnki(cards)}
                  className="w-full mt-4 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl font-semibold text-sm transition-colors"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                  Export {cards.length} cards to Anki
                </button>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

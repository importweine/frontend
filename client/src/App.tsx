import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import DeckView from "./pages/DeckView";
import StudyMode from "./pages/StudyMode";
import CardEditor from "./pages/CardEditor";

export default function App() {
  return (
    <Routes>
      <Route path="/deck/:id/study" element={<StudyMode />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/deck/:id" element={<DeckView />} />
        <Route path="/deck/:id/cards/new" element={<CardEditor />} />
        <Route path="/deck/:id/cards/:cardId/edit" element={<CardEditor />} />
      </Route>
    </Routes>
  );
}

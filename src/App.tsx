import { GameCanvas } from './renderer/GameCanvas';

export function App() {
  return (
    <div className="app">
      <GameCanvas />
      <div className="ui-overlay">
        <header className="title">
          <h1>Spirit Hacker</h1>
          <span>prototype</span>
        </header>
      </div>
    </div>
  );
}

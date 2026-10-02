import { GameCanvas } from './renderer/GameCanvas';
import { DebugPanel } from './ui/DebugPanel';
import { EnemyInfo } from './ui/EnemyInfo';

export function App() {
  return (
    <div className="app">
      <GameCanvas />
      <div className="ui-overlay">
        <header className="title">
          <h1>Spirit Hacker</h1>
          <span>prototype // hex grid</span>
        </header>
        <EnemyInfo />
        <DebugPanel />
      </div>
    </div>
  );
}

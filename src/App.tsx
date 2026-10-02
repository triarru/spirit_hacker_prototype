import { GameCanvas } from './renderer/GameCanvas';
import { DebugPanel } from './ui/DebugPanel';
import { EnemyInfo } from './ui/EnemyInfo';
import { HUD } from './ui/HUD';

export function App() {
  return (
    <div className="app">
      <GameCanvas />
      <div className="ui-overlay">
        <header className="title">
          <h1>Spirit Hacker</h1>
          <span>prototype</span>
        </header>
        <HUD />
        <EnemyInfo />
        <DebugPanel />
      </div>
    </div>
  );
}

import { GameCanvas } from './renderer/GameCanvas';
import { DebugPanel } from './ui/DebugPanel';
import { EnemyInfo } from './ui/EnemyInfo';
import { GameOverScreen } from './ui/GameOverScreen';
import { HUD } from './ui/HUD';
import { SpellBar } from './ui/SpellBar';
import { TurnIndicator } from './ui/TurnIndicator';

export function App() {
  return (
    <div className="app">
      <GameCanvas />
      <div className="ui-overlay">
        <header className="title">
          <h1>Spirit Hacker</h1>
          <span>prototype</span>
        </header>
        <TurnIndicator />
        <HUD />
        <EnemyInfo />
        <DebugPanel />
        <SpellBar />
        <GameOverScreen />
      </div>
    </div>
  );
}

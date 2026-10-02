import { GameCanvas } from './renderer/GameCanvas';
import { ActionMenu } from './ui/ActionMenu';
import { CombatLog } from './ui/CombatLog';
import { Controls } from './ui/Controls';
import { EnemyInfo } from './ui/EnemyInfo';
import { GameOverScreen } from './ui/GameOverScreen';
import { HUD } from './ui/HUD';
import { LoadoutScreen } from './ui/LoadoutScreen';
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
        <Controls />
        <CombatLog />
        <SpellBar />
        <ActionMenu />
        <GameOverScreen />
        <LoadoutScreen />
      </div>
    </div>
  );
}

import { GameCanvas } from './renderer/GameCanvas';
import { useUIStore } from './stores/useUIStore';
import { ActionBar } from './ui/ActionBar';
import { ActionMenu } from './ui/ActionMenu';
import { CombatLog } from './ui/CombatLog';
import { EnemyInfo } from './ui/EnemyInfo';
import { GameOverScreen } from './ui/GameOverScreen';
import { HUD, Passives } from './ui/HUD';
import { useLabels } from './ui/labels';
import { LoadoutScreen } from './ui/LoadoutScreen';
import { SpellBar } from './ui/SpellBar';
import { TurnIndicator } from './ui/TurnIndicator';
import { useHotkeys } from './ui/useHotkeys';

export function App() {
  useHotkeys();
  const mode = useUIStore((state) => state.mode);
  const toggleMode = useUIStore((state) => state.toggleMode);
  const labels = useLabels();

  return (
    // The mode is a skin: it picks the palette, the typeface and the words, nothing else.
    <div className="app" data-mode={mode}>
      <GameCanvas />
      <div className="ui-overlay">
        <div className="frame" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
        <HUD />
        <TurnIndicator />
        <header className="title">
          <h1>Spirit Hacker</h1>
          <span>prototype</span>
          <button
            type="button"
            className="mode-switch"
            onClick={(event) => {
              event.currentTarget.blur();
              toggleMode();
            }}
          >
            {labels.switchTo} <kbd>V</kbd>
          </button>
        </header>
        <Passives />
        <EnemyInfo />
        <ActionBar />
        <CombatLog />
        <SpellBar />
        <ActionMenu />
        <GameOverScreen />
        <LoadoutScreen />
      </div>
    </div>
  );
}

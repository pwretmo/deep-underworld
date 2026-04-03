import { Game } from './Game.js';

const game = new Game(await Game.resolveRendererOptions());
await game.init();

// Expose game instance globally for automated testing (UX Tester / Chrome DevTools)
// @ts-ignore — custom global for test automation
window.game = game;

document.getElementById('loading').classList.add('hidden');

const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');

startBtn.addEventListener('click', () => {
  game.start();
});

restartBtn.addEventListener('click', () => {
  game.restart();
});

const activateOnKeyboard = (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    e.currentTarget.click();
  }
};

startBtn.addEventListener('keydown', activateOnKeyboard);
restartBtn.addEventListener('keydown', activateOnKeyboard);

// Autoplay mode: ?autoplay in URL skips the menu and starts gameplay without pointer lock.
// This lets automated testing tools (Chrome DevTools MCP) drive the game via keyboard
// events and evaluate_script without needing a real user click for pointer lock.
if (new URLSearchParams(window.location.search).has('autoplay')) {
  game.startAutoplay();
}

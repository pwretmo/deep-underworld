import { Game } from './Game.js';

const game = new Game();

// Expose game instance globally for automated testing (UX Tester / Chrome DevTools)
window.game = game;

document.getElementById('loading').classList.add('hidden');

document.getElementById('start-btn').addEventListener('click', () => {
  game.start();
});

document.getElementById('restart-btn').addEventListener('click', () => {
  game.restart();
});

// Autoplay mode: ?autoplay in URL skips the menu and starts gameplay without pointer lock.
// This lets automated testing tools (Chrome DevTools MCP) drive the game via keyboard
// events and evaluate_script without needing a real user click for pointer lock.
if (new URLSearchParams(window.location.search).has('autoplay')) {
  game.startAutoplay();
}

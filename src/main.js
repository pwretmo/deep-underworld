import { Game } from './Game.js';

const game = new Game();

document.getElementById('loading').classList.add('hidden');

document.getElementById('start-btn').addEventListener('click', () => {
  game.start();
});

document.getElementById('restart-btn').addEventListener('click', () => {
  game.restart();
});

'use strict';

const terminalOverlay = document.getElementById('terminal-overlay');
const terminalButton = document.getElementById('terminal-button');
const terminalClose = document.getElementById('terminal-close');
const terminalMount = document.getElementById('terminal-mount');

let term = null;
let fitAddon = null;

function ensureTerminal() {
  if (term) return;
  term = new Terminal({ convertEol: true, fontSize: 13, cursorBlink: true, theme: { background: '#10163a' } });
  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(terminalMount);

  term.onData((data) => {
    if (ws && wsOpen) ws.send(JSON.stringify({ type: 'terminal_input', data }));
  });

  new ResizeObserver(() => {
    fitAddon.fit();
    if (ws && wsOpen) ws.send(JSON.stringify({ type: 'terminal_resize', cols: term.cols, rows: term.rows }));
  }).observe(terminalMount);
}

function openTerminal() {
  terminalOverlay.hidden = false;
  terminalButton.classList.remove('needs-attention');
  ensureTerminal();
  fitAddon.fit();
  if (ws && wsOpen) ws.send(JSON.stringify({ type: 'terminal_subscribe' }));
}

function closeTerminal() {
  terminalOverlay.hidden = true;
}

terminalButton.addEventListener('click', openTerminal);
terminalClose.addEventListener('click', closeTerminal);
terminalOverlay.addEventListener('click', (ev) => {
  if (ev.target === terminalOverlay) closeTerminal();
});

window.TerminalView = {
  isOpen() { return !terminalOverlay.hidden; },
  open() { openTerminal(); },
  flagAttention() { terminalButton.classList.add('needs-attention'); },
  handleScrollback(data) {
    ensureTerminal();
    term.write(data);
  },
  handleData(data) {
    if (term) term.write(data);
  },
  handleExit() {
    if (term) term.write('\r\n\x1b[31m[sesion de terminal terminada]\x1b[0m\r\n');
  }
};

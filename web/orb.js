import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThinkingOrb } from 'thinking-orbs';

const mount = document.getElementById('thinking-orb');
if (mount) {
  createRoot(mount).render(React.createElement(ThinkingOrb, { state: 'solving', size: 64 }));
}

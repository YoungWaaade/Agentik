import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import App from './App.jsx';
import { applyTheme } from './theme.js';
import { takeLaunchRoute } from './push.js';

applyTheme();
takeLaunchRoute();

createRoot(document.getElementById('root')).render(<App />);

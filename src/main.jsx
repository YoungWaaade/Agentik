import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import App from './App.jsx';
import { takeLaunchRoute } from './push.js';

takeLaunchRoute();

createRoot(document.getElementById('root')).render(<App />);

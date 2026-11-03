import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import './theme.js';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(<App />);

import React from 'react';
import {createRoot} from 'react-dom/client';
import ScheduleSettings from '../../src/components/ScheduleSettings.jsx';
import '../../src/styles/app.css';

createRoot(document.getElementById('root')).render(<ScheduleSettings uid="settings-help" history={[]} ready error={null} onClose={() => {}} discord={null} />);

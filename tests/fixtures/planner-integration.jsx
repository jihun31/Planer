import React from 'react';
import {createRoot} from 'react-dom/client';
import PlannerTab from '../../src/components/tabs/PlannerTab.jsx';
import '../../src/styles/app.css';
const history=[{effectiveDate:'1000-01-01',startHour:8,endHour:3}];
createRoot(document.getElementById('root')).render(<main style={{maxWidth:1280,margin:'24px auto'}}>
  <section id="study"><PlannerTab uid="preview-study" scheduleHistory={history} settingsReady active={false}/></section>
  <section id="control" style={{marginTop:30}}><PlannerTab uid="preview-control" scheduleHistory={history} settingsReady control active={false}/></section>
</main>);

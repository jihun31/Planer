import React from 'react';
import {createRoot} from 'react-dom/client';
import DiscordLinkSection from '../../src/components/DiscordLinkSection.jsx';
import '../../src/styles/app.css';

createRoot(document.getElementById('root')).render(<div className="schedule-settings">
  <DiscordLinkSection uid="alert-user" discord={{ ready: true, link: { discordId: '1' }, error: null }} serverInfo={{ name: '테스트 서버' }} />
</div>);

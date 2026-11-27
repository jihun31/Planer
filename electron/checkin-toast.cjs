// 돈까스 인증 알림의 Windows 알림 모양.
// 'reminder' 형식에 버튼을 달면 Windows가 몇 초 뒤 알림 센터로 넣지 않고, 사용자가 누르거나 닫을 때까지 화면에 남긴다.
const escapeXml = text => text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]);

function checkInToastXml(title, body) {
  return `<toast scenario="reminder" launch="checkin:open">
  <visual>
    <binding template="ToastGeneric">
      <text>${escapeXml(title)}</text>
      <text>${escapeXml(body)}</text>
    </binding>
  </visual>
  <actions>
    <action content="인증하러 가기" arguments="checkin:open" activationType="foreground"/>
    <action content="닫기" arguments="dismiss" activationType="system"/>
  </actions>
</toast>`;
}

module.exports = { checkInToastXml };

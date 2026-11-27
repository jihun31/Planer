const test = require('node:test');
const assert = require('node:assert/strict');
const { checkInToastXml } = require('../electron/checkin-toast.cjs');

test('인증 알림은 닫을 때까지 남는 reminder 형식이고 버튼이 있다', () => {
  const xml = checkInToastXml('돈까스 인증 2개가 남았어요', '[일일] 운동\n[일일] 일기');
  assert.match(xml, /<toast scenario="reminder"/);
  // reminder 형식은 버튼이 하나 이상 있어야 화면에 남는다
  assert.match(xml, /<action content="인증하러 가기" arguments="checkin:open" activationType="foreground"\/>/);
  assert.match(xml, /<action content="닫기" arguments="dismiss" activationType="system"\/>/);
  assert.match(xml, /<text>돈까스 인증 2개가 남았어요<\/text>/);
  assert.match(xml, /<text>\[일일\] 운동\n\[일일\] 일기<\/text>/);
});

test('계획 이름의 XML 특수 문자는 이스케이프한다', () => {
  const xml = checkInToastXml('제목', '[일일] <책> & "글" \'쓰기\'');
  assert.match(xml, /<text>\[일일\] &lt;책&gt; &amp; &quot;글&quot; &apos;쓰기&apos;<\/text>/);
  assert.doesNotMatch(xml, /<책>/);
});

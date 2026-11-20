// 앱의 모든 스타일시트를 여기서 한 번에, 정해진 순서로 불러온다.
// 탭 코드는 처음 열 때 받지만(App.jsx의 lazyViews), 스타일까지 나중에 붙으면 먼저 연 탭에 따라
// 규칙 순서가 바뀌어 같은 우선순위의 규칙끼리 결과가 달라진다. 그래서 스타일은 시작할 때 모두 붙인다.
// 아래 순서는 나누기 전 번들의 순서와 같다. 새 스타일시트는 여기에 추가한다(tests/css-ownership.test.mjs가 검사).
import './planner.css';
import './day-plans.css';
import './habits.css';
import './rest-timer.css';
import './learning.css';
import './notes.css';
import './calendar.css';
import './tonkatsu.css';
import './app.css';
import './goals.css';
import './tasks.css';

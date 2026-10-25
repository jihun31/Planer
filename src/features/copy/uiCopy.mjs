export const UI_COPY = {
  "guide": {
    "title": "빠른 사용법",
    "guideHeading": "가이드",
    "todayTitle": "오늘 할 일",
    "today": "날짜별 할 일, 우선순위, 월별 목표를 정리합니다.",
    "plannerTitle": "시간 관리",
    "planner": "타이머를 사용하거나, 시간표를 눌러 직접 활동 시간을 기록할 수 있습니다.\n빠른 시작: 상단 활동명을 눌러 바로 타이머를 시작할 수 있습니다.\n빠른 기록: 시간표를 채우고 상단 활동명을 누르면 즉시 기록됩니다.\n",
    "controlTitle": "통제",
    "control": "필요하거나 계획한 활동은 ‘통제’, 줄이고 싶은 낭비 시간은 ‘어리석음’으로 나누어 기록합니다.",
    "learningTitle": "학습 기록",
    "learning": "먼저 목표 학습 시간을 설정합니다.\n하루 합계가 목표에 도달하면 학습일로 기록됩니다.",
    "calendarTitle": "캘린더",
    "calendar": "날짜를 선택해 일정을 등록합니다.\n‘할 일 등록’을 선택하면 해당 날짜를 마감일로 지정해 ‘할 일’ 블록에 추가됩니다.",
    "notesTitle": "메모",
    "notes": "메모를 폴더로 나누어 관리합니다.\n사용법은 좌측 하단 '단축키' 버튼을 통해 확인할 수 있습니다.\n",
    "shortcutsHeading": "단축키",
    "tabKeys": "Tab / Shift + Tab",
    "tabAction": "다음 탭 / 이전 탭으로 이동",
    "arrowKeys": "← →",
    "arrowAction": "각 탭에서 날짜 이동",
    "shortcutsNote": "",
    "settingsHeading": "설정",
    "settings": "설정에서 커스텀 기능을 사용할 수 있습니다.\n1. 통제·메모·캘린더 탭 숨기기\n2. 타이머 설정: 팝업 표시 여부·기본 위치, 통제 활동 자동 기록\n3. 하루 시간표 범위 수정, 반대편 탭의 블록 표시 방식 설정"
  },
  "settings": {
    "title": "설정",
    "timerHeading": "타이머",
    "timerPopup": "타이머 팝업 표시",
    "timerPopupPosition": "팝업 기본 위치",
    "timerPopupLeft": "왼쪽 아래",
    "timerPopupRight": "오른쪽 아래",
    "studyGap": "통제 자동 기록",
    "studyGapNote": "타이머를 시작할 때 직전 기록 이후의 빈 시간을 통제 활동으로 기록합니다.",
    "tabsHeading": "탭 표시",
    "controlTab": "통제 탭 표시",
    "notesTab": "메모 탭 표시",
    "calendarTab": "캘린더 탭 표시",
    "calendarHeading": "시간 관리·통제 캘린더",
    "rangeNote": "달력에 표시할 하루의 시간 범위",
    "start": "시작",
    "end": "종료",
    "rangeHistory": "시간 범위 변경은 오늘부터 적용됩니다.\n이전 날짜의 시간 범위와 기록은 유지됩니다.",
    "dayBoundary": "",
    "oppositeHeading": "반대편 탭의 블록 표시",
    "plannerOpposite": "시간 관리 탭에서 통제 블록",
    "controlOpposite": "통제 탭에서 공부 블록",
    "displayAll": "모두 표시",
    "displayFaded": "흐릿하게",
    "displayHidden": "투명화",
    "displayBlind": "블라인드",
    "close": "닫기",
    "save": "저장",
    "saving": "저장 중…"
  }
};

export function copyValues(section,data) {
  return Object.fromEntries(Object.entries(UI_COPY[section]).map(([key,value]) => [key,
    typeof data?.sections?.[section]?.items?.[key]?.text === 'string' ? data.sections[section].items[key].text : value]));
}
export function copyEdits(section,values) {
  return Object.fromEntries(Object.entries(UI_COPY[section]).filter(([key,original]) => values[key] !== original)
    .map(([key,original]) => [key,{original,text:values[key]}]));
}

import { useState } from 'react';

// 설정 항목의 설명 문구는 평소에 숨기고, 항목 옆 ? 버튼으로 펼친다.
// showAll이면(문구 수정 중) 설명을 고칠 수 있게 모두 펼치고 ? 버튼은 감춘다.
export function useSettingHelp(showAll = false) {
  const [open, setOpen] = useState({});
  const shown = key => showAll || Boolean(open[key]);
  const button = (key, name) => showAll ? null : <button type="button" className="setting-help-toggle"
    aria-expanded={shown(key)} aria-label={`${name} 설명 ${shown(key) ? '숨기기' : '보기'}`} title={shown(key) ? '설명 숨기기' : '설명 보기'}
    onClick={event => {
      // 체크박스 label 안에 있어도 체크 상태가 바뀌지 않게 한다.
      event.preventDefault();
      setOpen(previous => ({ ...previous, [key]: !previous[key] }));
    }}>?</button>;
  return { button, shown };
}

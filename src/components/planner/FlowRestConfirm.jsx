import { useEffect, useRef, useState } from 'react';

// 기록 타이머의 휴식 요청(onFlowRest)을 받아 확인 창을 띄우고, 휴식 시작을 누를 때만 onStart(request)를 부른다.
// key가 바뀌면(계정 전환) 떠 있던 창을 닫는다. 반환: [요청을 받는 함수, 그릴 창(없으면 null)]
export function useFlowRestConfirm(onStart, key) {
  const [ask, setAsk] = useState(null);
  useEffect(() => { setAsk(null); }, [key]);
  const dialog = ask && <FlowRestConfirm minutes={ask.minutes}
    onStart={() => { setAsk(null); onStart(ask); }} onSkip={() => setAsk(null)} />;
  return [request => setAsk({ ...request }), dialog];
}

// 기록 타이머를 정지한 뒤 휴식 타이머를 시작할지 묻는 창(작업 종료 시 휴식 타이머 연결).
// 휴식 시작을 눌러야만 휴식이 시작된다. 건너뛰기·ESC·바깥 클릭은 창만 닫는다.
export default function FlowRestConfirm({ minutes, onStart, onSkip }) {
  const dialog = useRef(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node.open) node.showModal();
    node.querySelector('[data-flow-rest-focus]')?.focus();
    return () => node.close();
  }, []);
  return <dialog ref={dialog} className="study-gap-dialog flow-rest-confirm" aria-labelledby="flow-rest-title"
    onCancel={event => { event.preventDefault(); onSkip(); }}
    onClick={event => {
      // 창 안쪽 여백을 눌러도 대상이 dialog 자신이므로, 누른 위치가 창 밖(배경)일 때만 닫는다.
      if (event.target !== event.currentTarget) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onSkip();
    }}>
    <h2 id="flow-rest-title">휴식할까요?</h2>
    <p>일한 시간에 맞춰 {minutes}분 쉴 수 있어요.</p>
    <div className="study-gap-actions">
      <button type="button" onClick={onSkip}>건너뛰기</button>
      <button type="button" className="study-gap-primary" data-flow-rest-focus onClick={onStart}>휴식 시작 ({minutes}분)</button>
    </div>
  </dialog>;
}

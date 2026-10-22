import { useLayoutEffect, useRef } from 'react';

export default function CopyField({value,editing,onChange,name}) {
  const element = useRef(null);
  useLayoutEffect(() => {
    if (editing && element.current.textContent !== value) element.current.textContent = value;
  },[editing,value]);
  if (!editing) return <span key="view" className="editable-copy-text">{value}</span>;
  return <span key="edit" ref={element} className="editable-copy-field" role="textbox" aria-label={`${name} 문구 수정`}
    contentEditable="plaintext-only" suppressContentEditableWarning onInput={event => {
      const text = event.currentTarget.innerText.replace(/\r/g,'');
      if (text.length > 5000) event.currentTarget.textContent = text.slice(0,5000);
      onChange(text.slice(0,5000));
    }} onPaste={event => {
      event.preventDefault();document.execCommand('insertText',false,event.clipboardData.getData('text/plain').slice(0,5000));
    }} />;
}

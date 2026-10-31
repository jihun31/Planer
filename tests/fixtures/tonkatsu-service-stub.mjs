// 화면 테스트용 가짜 Firestore 쓰기 함수 (tests/tonkatsu-tabs.test.mjs)
export const calls = [];
const record = (name) => async (...args) => { calls.push([name, ...args]); };
export const addPlan = record('addPlan');
export const editPlan = record('editPlan');
export const deletePlan = record('deletePlan');
export const checkIn = record('checkIn');
export const cancelCheckIn = record('cancelCheckIn');
export const takeRest = record('takeRest');
export const cancelRest = record('cancelRest');
export const setAlertHour = record('setAlertHour');
export const subscribeTonkatsu = () => () => {};

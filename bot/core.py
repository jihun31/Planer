"""
돈까스봇 계산 규칙 (디스코드·Firestore와 무관한 순수 함수).

'유저 뷰(view)'는 한 멤버의 데이터를 계산하기 쉽게 모아 둔 dict입니다. store.py가 Firestore 데이터로 만듭니다.
  {
    "Daily": [plan, ...], "Weekly": [...], ...   # 활성 계획 (카테고리별)
    "completed_goals": [plan, ...],              # 달성한 목표
    "rest_history": ["YYYY-MM-DD", ...],         # 휴식한 날
    "exemptions": ["YYYY-MM-DD", ...],           # 면책받은 날
    "fines": int, "alert_time": int,
  }
plan = Firestore 계획 문서 + "id" + "history"(인증 날짜 목록, 제한 계획은 같은 날짜가 여러 번) + "created_at"(=startDate)
"""
import calendar
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
DAY_START_HOUR = 5   # 하루 기준: 새벽 5시 (Planer 앱 시간관리와 같음). 0:00~4:59는 전날

WEEKDAY_NAMES = ["월", "화", "수", "목", "금", "토", "일"]
PLAN_CATEGORIES = ["Daily", "Routine", "Weekly", "Monthly", "Interval", "OneTime", "Limit"]
CATEGORY_KR = {"Daily": "일일", "Routine": "요일", "Weekly": "주간", "Monthly": "월간", "Interval": "반복", "OneTime": "목표", "Limit": "제한"}
LIMIT_PERIOD_KR = {"day": "하루", "week": "이번 주", "month": "이번 달"}

def get_now():
    return datetime.now(KST)

def get_base_date(now=None):
    """하루 기준 날짜. 새벽 0~4시는 전날로 취급 (밤샘 인증 배려)"""
    if now is None:
        now = get_now()
    return now - timedelta(days=1) if now.hour < DAY_START_HOUR else now

def is_dawn(now=None):
    return (now or get_now()).hour < DAY_START_HOUR

def day_str(date):
    return date.strftime('%Y-%m-%d')

def resolve_target_date(date_value):
    """'today'/'yesterday'(또는 None) → 기준 날짜"""
    base_date = get_base_date()
    return base_date - timedelta(days=1) if date_value == "yesterday" else base_date

def iter_plans(view, categories=PLAN_CATEGORIES):
    """(카테고리, 계획) 순서로 돌려줌"""
    for category in categories:
        for plan in view.get(category, []):
            yield category, plan

def has_active_plans(view):
    return any(True for _ in iter_plans(view))

def week_bounds(date):
    """date가 속한 주의 (월요일, 다음 주 월요일). 범위는 월요일 이상 ~ 다음 주 월요일 미만"""
    start = date - timedelta(days=date.weekday())
    return day_str(start), day_str(start + timedelta(days=7))

def count_in_week(history, date):
    start, next_start = week_bounds(date)
    return sum(1 for d in history if start <= d < next_start)

def count_in_month(history, date):
    prefix = date.strftime('%Y-%m')
    return sum(1 for d in history if d.startswith(prefix))

def count_in_period(history, date, period):
    """제한 계획용: date가 속한 하루/주/달 동안의 기록 수"""
    if period == "day":
        return history.count(day_str(date))
    if period == "week":
        return count_in_week(history, date)
    return count_in_month(history, date)

def limit_status(plan, date):
    """제한 계획의 (현재 횟수, 최대 횟수, 기간 이름)"""
    period = plan.get('period', 'week')
    return count_in_period(plan.get('history', []), date, period), plan.get('limit', 0), LIMIT_PERIOD_KR.get(period, period)

def count_off_days(view, start_str, end_str):
    """기간(양 끝 포함) 안의 휴식/면책 날짜 수. 둘이 겹친 날은 한 번만 셈."""
    off_days = set(view.get('rest_history', [])) | set(view.get('exemptions', []))
    return sum(1 for d in off_days if start_str <= d <= end_str)

def get_weekly_target(view, plan, target_date):
    """이번 주 실제 목표 횟수 = 원래 목표 - 이번 주 휴식/면책 일수"""
    start_str, _ = week_bounds(target_date)
    end_str = day_str(datetime.strptime(start_str, '%Y-%m-%d') + timedelta(days=6))
    return max(0, plan.get('count', 1) - count_off_days(view, start_str, end_str))

def get_monthly_target(view, plan, target_date):
    """이번 달 실제 목표 횟수 = 원래 목표 - 이번 달 휴식/면책 일수"""
    last_day = calendar.monthrange(target_date.year, target_date.month)[1]
    start_str = target_date.strftime('%Y-%m-01')
    end_str = target_date.strftime(f'%Y-%m-{last_day:02d}')
    return max(0, plan.get('count', 1) - count_off_days(view, start_str, end_str))

def _days_between(later_str, earlier_str):
    return (datetime.strptime(later_str, "%Y-%m-%d") - datetime.strptime(earlier_str, "%Y-%m-%d")).days

# ---------- 화면 표시 ----------

def plan_progress_line(view, category, plan, target_date):
    """인증 후 '현재 진행 상황'의 (표시, 설명)"""
    target_date_str = day_str(target_date)
    history = plan.get('history', [])

    if category in ("Daily", "Routine"):
        mark = "✅" if target_date_str in history else "⬜"
        return mark, "[매일]" if category == "Daily" else "[요일]"

    if category in ("Weekly", "Monthly"):
        if category == "Weekly":
            count, target = count_in_week(history, target_date), get_weekly_target(view, plan, target_date)
        else:
            count, target = count_in_month(history, target_date), get_monthly_target(view, plan, target_date)
        if count >= target: mark = "✅"
        elif target_date_str in history: mark = "☑️"
        else: mark = "⬜"
        return mark, f"[{count}/{target}회]"

    if category == "Interval":
        interval = plan.get('interval', 2)
        text = f"[{interval}일장]"
        if not history:
            return "🚨", text
        if history[-1] == target_date_str:
            return "✅", text + "(완료)"
        diff = _days_between(target_date_str, history[-1])
        if diff > interval: return "🚨", text + f"(D+{diff-interval})"
        if diff == interval: return "🔥", text + "(오늘 마감!)"
        return "💤", text + f"(D-{interval-diff})"

    if category == "Limit":
        count, limit, period_kr = limit_status(plan, target_date)
        mark = "🚨" if count > limit else ("⚠️" if count == limit else "🟢")
        return mark, f"[제한 {period_kr} {count}/{limit}회]"

    # OneTime
    if plan.get('completed', False):
        return "🏆", "[목표달성]"
    days_left = _days_between(plan.get('deadline', '9999-12-31'), target_date_str)
    if days_left < 0: return "💀", f"[마감지남 D+{abs(days_left)}]"
    if days_left == 0: return "🔥", "[오늘마감]"
    return "⏳", f"[D-{days_left}]"

def plan_status_line(view, category, plan, display_date):
    """/계획표에 보여줄 한 줄"""
    today_str = day_str(display_date)
    history = plan.get('history', [])
    content = plan['content']

    if category == "Daily":
        return f"✅ ~~{content}~~ (완료)" if today_str in history else f"⬜ {content}"

    if category == "Routine":
        plan_days = plan.get('days', [])
        day_badge = f" ({', '.join(plan_days)})" if plan_days else " (요일 미지정)"
        if today_str in history:
            return f"✅ ~~{content}~~{day_badge} (완료)"
        if plan_days and WEEKDAY_NAMES[display_date.weekday()] not in plan_days:
            return f"💤 {content}{day_badge} (쉬는 날)"
        return f"⬜ {content}{day_badge}"

    if category in ("Weekly", "Monthly"):
        original_target = plan.get('count', 1)
        if category == "Weekly":
            current, real = count_in_week(history, display_date), get_weekly_target(view, plan, display_date)
        else:
            current, real = count_in_month(history, display_date), get_monthly_target(view, plan, display_date)
        target_display = f"{real}회 (📉원래 {original_target}회)" if real < original_target else f"{real}회"
        progress = f"({current}/{target_display})"
        if current >= real: return f"✅ ~~{content}~~ {progress}"
        if today_str in history: return f"☑️ {content} {progress}"
        return f"⬜ {content} {progress}"

    if category == "Interval":
        interval = plan.get('interval', 2)
        if not history:
            return f"🚨 {content} (시작 전)"
        if history[-1] == today_str:
            return f"✅ ~~{content}~~ (오늘 완료)"
        diff = _days_between(today_str, history[-1])
        if diff > interval: return f"🚨 {content} (마감지남 D+{diff-interval})"
        if diff == interval: return f"🔥 {content} (오늘 마감!)"
        return f"💤 {content} (D-{interval-diff})"

    if category == "Limit":
        count, limit, period_kr = limit_status(plan, display_date)
        progress = f"({period_kr} {count}/{limit}회)"
        if count > limit: return f"🚨 {content} {progress} 초과! 벌금 대상"
        if count == limit: return f"⚠️ {content} {progress} 한도 도달"
        return f"🟢 {content} {progress} {limit - count}회 남음"

    # OneTime
    if plan.get('completed', False):
        return f"🏆 ~~{content}~~ (달성 완료!)"
    days_left = _days_between(plan.get('deadline', '9999-12-31'), today_str)
    if days_left < 0: return f"💀 {content} (마감 {abs(days_left)}일 지남)"
    if days_left == 0: return f"🔥 {content} (오늘 마감!)"
    return f"⏳ {content} (D-{days_left})"

def autocomplete_tag(view, category, plan, target_date):
    """/인증 자동완성에 보여줄 태그. 그날 인증할 필요가 없으면 None"""
    target_date_str = day_str(target_date)
    history = plan.get('history', [])

    # 제한 계획은 같은 날 여러 번 기록할 수 있어서 항상 보여줌
    if category == "Limit":
        count, limit, period_kr = limit_status(plan, target_date)
        return f"제한 {period_kr} {count}/{limit}회" + (" 🚨초과" if count > limit else "")

    if target_date_str in history:
        return None
    if category == "Daily":
        return "일일"
    if category == "Routine":
        plan_days = plan.get('days', [])
        if plan_days and WEEKDAY_NAMES[target_date.weekday()] not in plan_days:
            return None
        return "요일"
    if category == "Weekly":
        final_target = get_weekly_target(view, plan, target_date)
        return None if count_in_week(history, target_date) >= final_target else f"주{final_target}회"
    if category == "Monthly":
        return None if count_in_month(history, target_date) >= get_monthly_target(view, plan, target_date) else "월간"
    if category == "Interval":
        interval = plan.get('interval', 1)
        if not history:
            return f"{interval}일장/시작전"
        diff = _days_between(target_date_str, history[-1])
        if diff < interval: return f"{interval}일장/D-{interval-diff}"
        if diff == interval: return f"{interval}일장/오늘마감"
        return f"{interval}일장/D+{diff-interval}"
    # OneTime
    return None if plan.get('completed') else f"~{plan.get('deadline', '날짜미정')}"

# ---------- 계획 수정 ----------

def condition_text(plan):
    """계획 조건을 짧게 (예: '주 3회', '이번 주 2회 이하')"""
    c = plan.get("category")
    if c == "Weekly": return f"주 {plan.get('count')}회"
    if c == "Monthly": return f"월 {plan.get('count')}회"
    if c == "Routine": return f"{''.join(plan.get('days', []))}요일"
    if c == "Interval": return f"{plan.get('interval')}일마다"
    if c == "OneTime": return f"{plan.get('deadline')}까지"
    if c == "Limit": return f"{LIMIT_PERIOD_KR.get(plan.get('period'), '')} {plan.get('limit')}회 이하"
    return "매일"

def describe_plan_changes(old, new):
    """조건이 바뀐 부분을 사람이 읽을 수 있게. 이름만 바뀌었으면 빈 목록"""
    changes = []
    if condition_text(old) != condition_text(new):
        changes.append(f"{condition_text(old)} → {condition_text(new)}")
    if bool(old.get("photo")) != bool(new.get("photo")):
        changes.append(f"사진 필수 {'O' if old.get('photo') else 'X'} → {'O' if new.get('photo') else 'X'}")
    return changes

# ---------- 정산 ----------

def find_missed_plans(view, now, is_monday, is_first_day):
    """어제(일일/요일/목표), 지난주(월요일), 지난달(1일) 기준으로 못 한 계획 목록"""
    missed = []
    yesterday = now - timedelta(days=1)
    yesterday_str = day_str(yesterday)
    yesterday_weekday = WEEKDAY_NAMES[yesterday.weekday()]

    for category, plan in iter_plans(view):
        history = plan.get('history', [])
        created_at = plan.get('created_at', '2000-01-01')

        if category == "Daily":
            if yesterday_str >= created_at and yesterday_str not in history:
                missed.append(f"[일일]{plan['content']}")
        elif category == "Routine":
            if yesterday_str >= created_at and yesterday_weekday in plan.get('days', []) and yesterday_str not in history:
                missed.append(f"[요일]{plan['content']}")
        elif category == "Weekly" and is_monday:
            last_week_start_str, _ = week_bounds(yesterday)
            if created_at <= last_week_start_str:  # 지난주 중간에 만든 계획은 첫 주 제외
                count, target = count_in_week(history, yesterday), get_weekly_target(view, plan, yesterday)
                if count < target:
                    missed.append(f"[주간]{plan['content']}({count}/{target}회)")
        elif category == "Monthly" and is_first_day:
            if created_at <= yesterday.strftime('%Y-%m-01'):  # 지난달 중간에 만든 계획은 첫 달 제외
                count, target = count_in_month(history, yesterday), get_monthly_target(view, plan, yesterday)
                if count < target:
                    missed.append(f"[월간]{plan['content']}({count}/{target}회)")
        elif category == "OneTime":
            if plan.get('deadline') == yesterday_str and not plan.get('completed', False):
                missed.append(f"[목표]{plan['content']}")
    return missed

def find_exceeded_limits(view, now, is_monday, is_first_day):
    """끝난 기간에 제한 횟수를 넘긴 제한 계획. 하루 제한은 매일, 주간은 월요일, 월간은 1일에 검사"""
    yesterday = now - timedelta(days=1)
    exceeded = []
    for _, plan in iter_plans(view, categories=["Limit"]):
        period = plan.get('period', 'week')
        if period == "week" and not is_monday: continue
        if period == "month" and not is_first_day: continue
        count, limit, _ = limit_status(plan, yesterday)
        if count > limit:
            period_kr = {"day": "어제", "week": "지난주", "month": "지난달"}.get(period, period)
            exceeded.append(f"[제한]{plan['content']}({period_kr} {count}/{limit}회)")
    return exceeded

def settle_user(view, now):
    """
    한 멤버의 어제 정산 결과: (벌금 여부, 메시지 종류, 상세 목록)
    종류: 'fine' / 'rest' / 'exempt' / None(해당 없음)
    """
    yesterday_str = day_str(now - timedelta(days=1))
    is_monday, is_first_day = now.weekday() == 0, now.day == 1
    missed = find_missed_plans(view, now, is_monday, is_first_day)
    exceeded = find_exceeded_limits(view, now, is_monday, is_first_day)
    if not missed and not exceeded:
        return False, None, []

    is_resting = yesterday_str in view.get('rest_history', [])
    excused = is_resting or yesterday_str in view.get('exemptions', [])
    # 휴식/면책은 '못 한 계획'만 봐줌. 제한 초과는 이미 한 일이라 봐주지 않음
    if exceeded or (missed and not excused):
        return True, 'fine', exceeded + ([] if excused else missed)
    return False, ('rest' if is_resting else 'exempt'), missed

# ---------- 알림 ----------

def find_todo_plans(view, alert_date):
    """알림 날짜 기준으로 아직 인증 안 한 계획 (카테고리별)"""
    alert_date_str = day_str(alert_date)
    alert_weekday = WEEKDAY_NAMES[alert_date.weekday()]
    last_day_of_month = calendar.monthrange(alert_date.year, alert_date.month)[1]
    todo = {category: [] for category in PLAN_CATEGORIES}

    for category, plan in iter_plans(view):
        history = plan.get('history', [])
        done_today = alert_date_str in history

        if category == "Daily":
            if not done_today:
                todo[category].append(plan['content'])
        elif category == "Routine":
            if alert_weekday in plan.get('days', []) and not done_today:
                todo[category].append(plan['content'])
        elif category == "Weekly":
            if alert_date.weekday() >= 4 and not done_today:
                cnt, target = count_in_week(history, alert_date), get_weekly_target(view, plan, alert_date)
                if target > 0 and cnt < target:
                    todo[category].append(f"{plan['content']}({cnt}/{target})")
        elif category == "Monthly":
            if alert_date.day in (20, 25, last_day_of_month) and not done_today:
                cnt, target = count_in_month(history, alert_date), get_monthly_target(view, plan, alert_date)
                if target > 0 and cnt < target:
                    todo[category].append(f"{plan['content']}({cnt}/{target})")
        elif category == "Interval":
            interval = plan.get('interval', 1)
            if not history:
                todo[category].append(f"{plan['content']}(시작안함)")
            elif not done_today:
                diff = _days_between(alert_date_str, history[-1])
                if diff >= interval:
                    todo[category].append(f"{plan['content']}(D+{diff-interval})")
        elif category == "OneTime":
            if not plan.get('completed', False):
                days_left = _days_between(plan.get('deadline', '9999-12-31'), alert_date_str)
                if days_left == 0:
                    todo[category].append(f"🔥 {plan['content']}(오늘마감!)")
                elif 0 < days_left <= 3:
                    todo[category].append(f"⏳ {plan['content']}(D-{days_left})")
    return todo

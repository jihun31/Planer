import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, resetKey: props.resetKey };
    this.handleRetry = this.handleRetry.bind(this);
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.resetKey) {
      return { hasError: false, resetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error, info) {
    console.error(`[ErrorBoundary:${this.props.scope || 'app'}]`, error, info);
  }

  handleRetry() {
    this.setState({ hasError: false });
    this.props.onReset?.();
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    const { scope = '화면', fullScreen = false } = this.props;
    return (
      <div
        role="alert"
        className={fullScreen ? 'error-boundary error-boundary-full' : 'error-boundary'}
        style={{
          padding: fullScreen ? '48px 24px' : '24px 16px',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
        }}
      >
        <p style={{ margin: 0, fontWeight: 600 }}>
          {scope}을(를) 표시하는 중 문제가 발생했습니다.
        </p>
        <p style={{ margin: 0, fontSize: '0.9rem', opacity: 0.8 }}>
          잠시 후 다시 시도해 주세요. 문제가 계속되면 앱을 새로고침해 주세요.
        </p>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" className="btn btn-login" onClick={this.handleRetry}>
            다시 시도
          </button>
          {fullScreen && (
            <button type="button" className="btn-signout" onClick={() => window.location.reload()}>
              새로고침
            </button>
          )}
        </div>
      </div>
    );
  }
}

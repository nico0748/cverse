import { Component, type ReactNode } from "react";

interface Props {
  /** 何の表示か（「詳細」「相関図」など）。 */
  name: string;
  /** これが変わったら、エラーを解いて描き直す（別のノードへ移ったときなど）。 */
  resetKey?: string | null;
  children: ReactNode;
}

/** 一部の表示で例外が起きても、画面全体が消えないようにする。 */
export class ErrorBoundary extends Component<Props, { failed: boolean; key: string | null | undefined }> {
  state = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: { failed: boolean; key: string | null | undefined }) {
    return props.resetKey === state.key ? null : { failed: false, key: props.resetKey };
  }

  componentDidCatch(error: unknown) {
    console.error(`${this.props.name}の表示に失敗しました`, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="panel__msg" role="alert">
        <p>{this.props.name}を表示できませんでした。</p>
        <button type="button" className="button" onClick={() => location.reload()}>
          ページを読み込み直す
        </button>
      </div>
    );
  }
}

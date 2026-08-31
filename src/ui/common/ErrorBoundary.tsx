import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/ui/common/Button';
import { logFailure } from '@/platform/diagnostics';

/**
 * 错误边界：捕获渲染期异常，降级为可重试的错误页而非白屏。
 *
 * 事件处理器与异步回调中的错误不在其捕获范围内，由各处的 logDegraded / logFailure 记录。
 */

interface ErrorBoundaryProps {
  /** 发生错误的形态名（sidepanel / popup / options），用于诊断日志定位。 */
  scope: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    logFailure(this.props.scope, '界面渲染异常，已降级为错误页', error);
    if (info.componentStack) {
      logFailure(this.props.scope, '组件栈', new Error(info.componentStack.trim()));
    }
  }

  /** 重置错误态：用户点击「重试」后重新渲染子树。 */
  private readonly handleRetry = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-xs font-medium text-gray-600">出了点意外</p>
        <p className="max-w-52 text-3xs leading-relaxed text-gray-600">
          界面遇到了无法自行恢复的错误。你的数据仍保存在本地，可以重试或重载页面。
        </p>
        <pre className="max-h-24 w-full overflow-auto rounded bg-gray-100 p-2 text-left text-3xs leading-snug text-gray-500">
          {error.message}
        </pre>
        <div className="flex items-center gap-1.5">
          <Button variant="primary" size="sm" onClick={this.handleRetry}>
            重试
          </Button>
          <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
            重载
          </Button>
        </div>
      </div>
    );
  }
}

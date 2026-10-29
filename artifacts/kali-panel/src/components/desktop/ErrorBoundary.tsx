import { Component, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw, X } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
    this.setState({ errorInfo: errorInfo.componentStack || null });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onReset?.();
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="w-full h-full min-h-[200px] flex items-center justify-center bg-card/50 backdrop-blur-sm rounded-lg border border-red-500/30 p-6">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-red-400" />
            </div>
            <h3 className="text-lg font-semibold text-red-400 mb-2">حدث خطأ</h3>
            <p className="text-sm text-muted-foreground mb-4 max-w-md">
              {this.state.error?.message || 'Unknown error occurred'}
            </p>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={this.handleReset}
                className="flex items-center gap-2 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                <span>إعادة المحاولة</span>
              </button>
              <button
                onClick={this.handleReload}
                className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
                <span>إعادة تحميل</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

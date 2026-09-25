import { Alert } from "antd";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { appErrorCode } from "../application/AppError";

interface ManagerErrorBoundaryProps {
  readonly children: ReactNode;
  readonly onError: (error: unknown, info: ErrorInfo) => void;
}

interface ManagerErrorBoundaryState {
  readonly failed: boolean;
}

export class ManagerErrorBoundary extends Component<
  ManagerErrorBoundaryProps,
  ManagerErrorBoundaryState
> {
  public override state: ManagerErrorBoundaryState = { failed: false };

  public static getDerivedStateFromError(): ManagerErrorBoundaryState {
    return { failed: true };
  }

  public override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError(error, info);
  }

  public override render(): ReactNode {
    if (this.state.failed) {
      return (
        <Alert
          type="error"
          showIcon
          title="ChatGPTCleaner could not display the manager. No new destructive operation was started."
          description={`Error code: ${appErrorCode("UnexpectedFailure")}`}
        />
      );
    }
    return this.props.children;
  }
}

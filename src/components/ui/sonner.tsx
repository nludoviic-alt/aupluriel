import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      position="bottom-right"
      gap={8}
      toastOptions={{
        duration: 4000,
        classNames: {
          toast: "lio-toast",
          title: "lio-toast-title",
          description: "lio-toast-description",
          icon: "lio-toast-icon",
          closeButton: "lio-toast-close",
          actionButton: "lio-toast-action",
          cancelButton: "lio-toast-cancel",
          success: "lio-toast--success",
          error: "lio-toast--error",
          warning: "lio-toast--warning",
          info: "lio-toast--info",
          loader: "lio-toast-loader",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };

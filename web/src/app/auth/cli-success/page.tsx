export default function CLISuccessPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center space-y-4">
        <div className="flex justify-center mb-4">
          <img src="/logo-icon.svg" alt="ServerMe" className="h-10 w-10 rounded-lg" />
        </div>
        <h2 className="text-xl font-semibold text-foreground">Signed in to CLI</h2>
        <p className="text-sm text-muted-foreground">
          You can close this tab and return to your terminal.
        </p>
      </div>
    </div>
  );
}

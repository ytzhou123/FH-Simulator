import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Home, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="max-w-sm text-center">
        <p className="text-sm font-medium text-rose-400">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          This page does not exist. The simulator is on the home page.
        </p>

        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <Button asChild className="rounded-full">
            <Link to="/">
              <Home />
              Open the simulator
            </Link>
          </Button>
          <Button variant="outline" className="rounded-full" onClick={() => window.history.back()}>
            <ArrowLeft />
            Go back
          </Button>
        </div>
      </div>
    </div>
  );
}

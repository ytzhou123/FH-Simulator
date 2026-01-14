import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Home, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-tech-dark-900 via-tech-blue-950 to-tech-dark-900 flex items-center justify-center px-6">
      <div className="text-center space-y-6 max-w-md">
        <div className="space-y-4">
          <h1 className="text-6xl font-bold text-tech-blue-400">FHS Simulator</h1>
          <h2 className="text-2xl font-semibold text-white">Click Go Home To Start Generate</h2>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button
            asChild
            className="bg-tech-blue-600 hover:bg-tech-blue-700 text-white"
          >
            <Link to="/">
              <Home className="h-4 w-4 mr-2" />
              Go Home
            </Link>
          </Button>
          
          <Button
            variant="outline"
            onClick={() => window.history.back()}
            className="border-tech-blue-500 text-tech-blue-300 hover:bg-tech-blue-600/20"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Go Back
          </Button>
        </div>
        
        <div className="pt-8">
          <img 
            src="https://cdn.builder.io/api/v1/image/assets%2F48e66d8efd9b4605abd90c97e923384d%2Fc920a09c86384c88aff437ac5866d971?format=webp&width=800" 
            alt="AuscultSim Logo" 
            className="h-12 w-auto mx-auto opacity-50"
          />
        </div>
      </div>
    </div>
  );
}

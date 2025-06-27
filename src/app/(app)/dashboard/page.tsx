import { getServerSession } from "next-auth/next"; 
import HomePageContent from "@/components/HomePageContent";


export default async function HomePage() {
  const session = await getServerSession(); 

  return <HomePageContent session={session} />;
}
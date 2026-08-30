import type { ReactNode } from 'react';
import './globals.css';
export const metadata={title:'HappyRobot Collaborative Tasks',description:'Real-time collaborative task management case study'};
export default function RootLayout({children}:{children:ReactNode}){return <html lang="en"><body>{children}</body></html>}

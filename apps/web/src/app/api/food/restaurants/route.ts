import { NextResponse } from 'next/server';
import { demoRestaurants } from '@superapp/food';
export async function GET() {
  return NextResponse.json({ demo:true, restaurants:demoRestaurants });
}

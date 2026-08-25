import { Tabs } from 'expo-router';

export default function TabsLayout() {
  return (
    <Tabs>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          headerShown: true,
        }}
      />
      <Tabs.Screen
        name="capture"
        options={{
          title: 'Capture',
          headerShown: true,
        }}
      />
      <Tabs.Screen
        name="memories"
        options={{
          title: 'Memories',
          headerShown: true,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          headerShown: true,
        }}
      />
      <Tabs.Screen
        name="ask"
        options={{
          title: 'Ask',
          headerShown: true,
        }}
      />
    </Tabs>
  );
}

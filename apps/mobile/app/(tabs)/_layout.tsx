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
      <Tabs.Screen
        name="reminders"
        options={{
          title: 'Reminders',
          headerShown: true,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          headerShown: true,
        }}
      />
      <Tabs.Screen
        name="capture"
        options={{
          href: null,
          title: 'Capture',
          headerShown: true,
        }}
      />
      <Tabs.Screen
        name="memories"
        options={{
          href: null,
          title: 'Memories',
          headerShown: true,
        }}
      />
      <Tabs.Screen
        name="collections"
        options={{
          href: null,
          title: 'Collections',
          headerShown: true,
        }}
      />
      <Tabs.Screen
        name="vault"
        options={{
          href: null,
          title: 'Vault',
          headerShown: true,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          href: null,
          title: 'Account',
          headerShown: true,
        }}
      />
    </Tabs>
  );
}

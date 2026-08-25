import 'react-native';

declare global {
  namespace React {
    interface ViewProps {
      className?: string;
    }
    interface TextProps {
      className?: string;
    }
    interface ScrollViewProps {
      className?: string;
    }
    interface TextInputProps {
      className?: string;
    }
    interface TouchableOpacityProps {
      className?: string;
    }
    interface ActivityIndicatorProps {
      className?: string;
    }
  }
}

declare module 'react-native' {
  interface ViewProps {
    className?: string;
  }
  interface TextProps {
    className?: string;
  }
  interface ScrollViewProps {
    className?: string;
  }
  interface TextInputProps {
    className?: string;
  }
  interface TouchableOpacityProps {
    className?: string;
  }
  interface ActivityIndicatorProps {
    className?: string;
  }
}

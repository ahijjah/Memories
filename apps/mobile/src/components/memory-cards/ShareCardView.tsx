import { View, Text } from 'react-native';
import { resolveCardType, type CardType } from './cardTypeResolver';
import { Memory } from '@/src/api/client';

interface ShareCardViewProps {
  memory: Memory;
  aiSummary: any;
  aiTopics: any;
  aiIntent: any;
  aiEntities: any;
  aiLocation: any;
  aiDate: any;
  aiBrand: any;
  aiModel: any;
  aiPrice: any;
  aiCategory: any;
  aiMerchant: any;
  aiOriginalPrice: any;
  aiOfferPrice: any;
  aiDiscount: any;
  aiPromoCode: any;
  sourceUri: any;
}

function getHighlightBoxStyle(cardType: CardType): { bgColor: string; borderColor: string; label: string } {
  switch (cardType) {
    case 'event':
      return { bgColor: 'bg-purple-50', borderColor: 'border-purple-200', label: 'When & Where' };
    case 'place':
      return { bgColor: 'bg-teal-50', borderColor: 'border-teal-200', label: 'Location' };
    case 'product':
      return { bgColor: 'bg-amber-50', borderColor: 'border-amber-200', label: 'Product' };
    case 'offer':
      return { bgColor: 'bg-red-50', borderColor: 'border-red-200', label: 'Offer' };
    case 'document':
      return { bgColor: 'bg-orange-50', borderColor: 'border-orange-200', label: 'Document' };
    default:
      return { bgColor: 'bg-gray-50', borderColor: 'border-gray-200', label: 'Details' };
  }
}

function renderHighlightBox(cardType: CardType, props: ShareCardViewProps): React.ReactElement | null {
  const { bgColor, borderColor, label } = getHighlightBoxStyle(cardType);

  switch (cardType) {
    case 'event':
      if (!props.aiDate && !props.aiLocation) return null;
      return (
        <View className={`p-4 ${bgColor} rounded-lg border ${borderColor} mb-4`}>
          <Text className="text-base font-semibold text-gray-900 mb-3">{label}</Text>
          {props.aiDate && (
            <Text className="text-sm text-gray-700 mb-2">
              <Text className="font-semibold">Date:</Text> {new Date(props.aiDate).toLocaleDateString()}
            </Text>
          )}
          {props.aiLocation && (
            <Text className="text-sm text-gray-700">
              <Text className="font-semibold">Location:</Text> {props.aiLocation}
            </Text>
          )}
        </View>
      );

    case 'place':
      if (!props.aiLocation && !props.aiCategory) return null;
      return (
        <View className={`p-4 ${bgColor} rounded-lg border ${borderColor} mb-4`}>
          <Text className="text-base font-semibold text-gray-900 mb-3">{label}</Text>
          {props.aiLocation && (
            <Text className="text-sm text-gray-700 mb-2">
              <Text className="font-semibold">Location:</Text> {props.aiLocation}
            </Text>
          )}
          {props.aiCategory && (
            <Text className="text-sm text-gray-700">
              <Text className="font-semibold">Category:</Text> {props.aiCategory}
            </Text>
          )}
        </View>
      );

    case 'product':
      if (!props.aiBrand && !props.aiModel && !props.aiPrice && !props.aiCategory) return null;
      return (
        <View className={`p-4 ${bgColor} rounded-lg border ${borderColor} mb-4`}>
          <Text className="text-base font-semibold text-gray-900 mb-3">{label}</Text>
          {props.aiBrand && (
            <Text className="text-sm text-gray-700 mb-2">
              <Text className="font-semibold">Brand:</Text> {props.aiBrand}
            </Text>
          )}
          {props.aiModel && (
            <Text className="text-sm text-gray-700 mb-2">
              <Text className="font-semibold">Model:</Text> {props.aiModel}
            </Text>
          )}
          {props.aiPrice && (
            <Text className="text-sm text-gray-700 mb-2">
              <Text className="font-semibold">Price:</Text> {props.aiPrice}
            </Text>
          )}
          {props.aiCategory && (
            <Text className="text-sm text-gray-700">
              <Text className="font-semibold">Category:</Text> {props.aiCategory}
            </Text>
          )}
        </View>
      );

    case 'offer':
      if (!props.aiMerchant && !props.aiOriginalPrice && !props.aiOfferPrice && !props.aiDiscount && !props.aiPromoCode && !props.aiDate) return null;
      return (
        <View className={`p-4 ${bgColor} rounded-lg border ${borderColor} mb-4`}>
          <Text className="text-base font-semibold text-gray-900 mb-3">{label}</Text>
          {props.aiMerchant && (
            <Text className="text-sm text-gray-700 mb-2">
              <Text className="font-semibold">Merchant:</Text> {props.aiMerchant}
            </Text>
          )}
          {props.aiOriginalPrice && (
            <Text className="text-sm text-gray-700 mb-2">
              <Text className="font-semibold">Original Price:</Text> {props.aiOriginalPrice}
            </Text>
          )}
          {props.aiOfferPrice && (
            <Text className="text-sm text-gray-700 mb-2">
              <Text className="font-semibold">Offer Price:</Text> {props.aiOfferPrice}
            </Text>
          )}
          {props.aiDiscount && (
            <Text className="text-sm text-gray-700 mb-2">
              <Text className="font-semibold">Discount:</Text> {props.aiDiscount}
            </Text>
          )}
          {props.aiPromoCode && (
            <Text className="text-sm text-gray-700 mb-2">
              <Text className="font-semibold">Promo Code:</Text> {props.aiPromoCode}
            </Text>
          )}
          {props.aiDate && (
            <Text className="text-sm text-gray-700">
              <Text className="font-semibold">Expires:</Text> {new Date(props.aiDate).toLocaleDateString()}
            </Text>
          )}
        </View>
      );

    case 'document':
      if (!props.aiDate && !props.aiCategory) return null;
      return (
        <View className={`p-4 ${bgColor} rounded-lg border ${borderColor} mb-4`}>
          <Text className="text-base font-semibold text-gray-900 mb-3">{label}</Text>
          {props.aiDate && (
            <Text className="text-sm text-gray-700 mb-2">
              <Text className="font-semibold">Date:</Text> {new Date(props.aiDate).toLocaleDateString()}
            </Text>
          )}
          {props.aiCategory && (
            <Text className="text-sm text-gray-700">
              <Text className="font-semibold">Category:</Text> {props.aiCategory}
            </Text>
          )}
        </View>
      );

    default:
      return null;
  }
}

export function ShareCardView(props: ShareCardViewProps) {
  const cardType = resolveCardType(props.memory);
  const title = props.memory.title || 'Memory';

  return (
    <View className="bg-white p-8 min-h-screen flex justify-between">
      {/* Content */}
      <View>
        {/* Title */}
        <Text className="text-2xl font-bold text-gray-900 mb-4 leading-tight">{title}</Text>

        {/* Highlight Box */}
        {renderHighlightBox(cardType, props)}

        {/* Summary */}
        {props.aiSummary && (
          <View className="mb-4">
            <Text className="text-base text-gray-700 leading-6">{props.aiSummary}</Text>
          </View>
        )}

        {/* Topics */}
        {props.aiTopics && Array.isArray(props.aiTopics) && props.aiTopics.length > 0 && (
          <View className="mb-4">
            <View className="flex-row flex-wrap gap-2">
              {props.aiTopics.slice(0, 3).map((topic: string, idx: number) => (
                <View key={idx} className="bg-blue-100 rounded-full px-3 py-1">
                  <Text className="text-blue-900 text-xs font-medium">{topic}</Text>
                </View>
              ))}
              {props.aiTopics.length > 3 && (
                <View className="bg-gray-100 rounded-full px-3 py-1">
                  <Text className="text-gray-900 text-xs font-medium">+{props.aiTopics.length - 3}</Text>
                </View>
              )}
            </View>
          </View>
        )}
      </View>

      {/* Branding Footer */}
      <View className="border-t border-gray-200 pt-4 mt-6">
        <Text className="text-xs text-gray-500">Saved with Memories</Text>
      </View>
    </View>
  );
}

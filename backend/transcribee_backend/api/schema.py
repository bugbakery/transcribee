from rest_framework import serializers
from rest_framework.schemas.openapi import AutoSchema, is_list_view


class DummySerializer(serializers.Serializer):
    def to_internal_value(self, data):
        return data

    def to_representation(self, instance):
        return instance

    def update(self, instance, validated_data):
        pass

    def create(self, validated_data):
        pass


class ValidationErrorSerializer(DummySerializer):
    errors = serializers.DictField(
        child=serializers.ListField(child=serializers.CharField())
    )
    non_field_errors = serializers.ListField(child=serializers.CharField())


class GenericErrorSerializer(DummySerializer):
    detail = serializers.CharField()


class UnauthenticatedErrorSerializer(GenericErrorSerializer):
    pass


class ForbiddenErrorSerializer(GenericErrorSerializer):
    pass


class NotFoundErrorSerializer(GenericErrorSerializer):
    pass


class MyAutoSchema(AutoSchema):
    def get_response_for_code(self, path, method, serializer, code):
        item_schema = self.get_reference(serializer())

        response_schema = item_schema

        return {
            "content": {
                ct: {"schema": response_schema} for ct in self.response_media_types
            },
            # description is a mandatory property,
            # https://github.com/OAI/OpenAPI-Specification/blob/master/versions/3.0.2.md#responseObject
            # TODO: put something meaningful into it
            "description": "",
        }

    def get_components(self, path, method):
        components = super().get_components(path, method)
        for code, serializer in self.get_error_codes(path, method):
            component_name = self.get_component_name(serializer())
            content = self.map_serializer(serializer())
            components.setdefault(component_name, content)
        return components

    def get_error_codes(self, path, method):
        error_codes = []
        if not method == "GET":
            error_codes.append(("400", ValidationErrorSerializer))

        error_codes.append(("401", UnauthenticatedErrorSerializer))
        error_codes.append(("403", ForbiddenErrorSerializer))

        if not (method == "GET" and not is_list_view(path, method, self.view)):
            error_codes.append(("404", NotFoundErrorSerializer))

        return error_codes

    def get_responses(self, path, method):
        responses = super().get_responses(path, method)

        for code, serializer in self.get_error_codes(path, method):
            responses[code] = self.get_response_for_code(path, method, serializer, code)
        return responses


class UserViewSetSchema(MyAutoSchema):
    def get_response_serializer(self, path, method):
        if (
            hasattr(self.view, "response_serializer")
            and self.view.response_serializer is not None
        ):
            return self.view.response_serializer(
                context=self.view.get_serializer_context()
            )

        return self.get_serializer(path, method)
